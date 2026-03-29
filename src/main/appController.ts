import fs from "node:fs/promises";
import path from "node:path";
import { app, shell } from "electron";
import { nanoid } from "nanoid";
import type {
  AppEventMap,
  AppSnapshot,
  AuthState,
  Conversation,
  CreateConversationInput,
  CreateWebsiteInput,
  DeployWebsiteInput,
  DispatchRunInput,
  RenameConversationInput,
  RenameWebsiteInput,
  RunEvent,
  AgentRun,
  PendingUserInputQuestion,
  PendingUserInputRequest,
  PublishRepoInput,
  ReorderConversationsInput,
  ReorderItemsInput,
  ProposedPlan,
  RespondUserInputInput,
  SaveSecretInput,
  UpdateSettingsInput,
  Website
} from "@shared/types";
import { executeWebsiteRun } from "./services/agent";
import { getGitHubToken, getOpenRouterApiKey, getVercelToken, launchProviderLogin, resolveAuthState } from "./services/auth";
import { CredentialVault } from "./services/credentials";
import { initGitRepository, publishGitHubRepository, publishGitHubRepositoryWithCli, readGitState } from "./services/git";
import { fetchOpenRouterModels } from "./services/models";
import { StateStore, type PersistedState } from "./services/persistence";
import { createStoppedPreviewState, PreviewManager } from "./services/preview";
import { scaffoldReactWebsite } from "./services/template";
import { runCommand, sanitizeProjectName } from "./services/utils";
import { deployWebsiteToVercel, deployWebsiteToVercelWithCli } from "./services/vercel";

function hasEphemeralPreviewRuntime(website: Website): boolean {
  return (
    website.preview.status !== "stopped" ||
    website.preview.port !== null ||
    website.preview.url !== null ||
    website.preview.command !== null
  );
}

export class AppController {
  private stateStore: StateStore;
  private vault: CredentialVault;
  private previewManager: PreviewManager;
  private authState: AuthState = {
    openRouterConfigured: false,
    githubConfigured: false,
    vercelConfigured: false,
    encryptionAvailable: false,
    openRouterSource: null,
    githubSource: null,
    vercelSource: null,
    githubCliInstalled: false,
    vercelCliInstalled: false
  };
  private state: PersistedState = {
    settings: {
      selectedWebsiteId: null,
      selectedConversationId: null,
      preferredModelId: "openrouter/auto",
      interactionMode: "chat",
      projectSortMode: "recent",
      conversationSortMode: "recent",
      ideCommand: "code",
      websitesRoot: null,
      useBundledRuntime: false,
      vercelTeamId: "",
      vercelTeamSlug: "",
      onboardingCompletedAt: null
    },
    websites: [],
    conversations: [],
    runs: [],
    proposedPlans: [],
    pendingUserInputs: [],
    models: [],
    modelsFetchedAt: null
  };
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly pendingUserInputResolvers = new Map<
    string,
    {
      runId: string;
      resolve: (answers: Record<string, string>) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(
    dataDirectory: string,
    private readonly emit: <K extends keyof AppEventMap>(channel: K, payload: AppEventMap[K]) => void
  ) {
    this.stateStore = new StateStore(dataDirectory);
    this.vault = new CredentialVault(dataDirectory);
    this.previewManager = new PreviewManager(async (websiteId, preview) => {
      this.state = {
        ...this.state,
        websites: this.state.websites.map((website) =>
          website.id === websiteId ? { ...website, preview, updatedAt: new Date().toISOString() } : website
        )
      };
      await this.persist();
      this.emit("preview-updated", { websiteId, preview });
      this.emit("snapshot", await this.getSnapshot());
    });
  }

  async initialize(): Promise<AppSnapshot> {
    this.state = await this.stateStore.load();
    const normalizedWebsites = this.state.websites.map((website) => {
      if (!hasEphemeralPreviewRuntime(website)) {
        return website;
      }

      return {
        ...website,
        preview: createStoppedPreviewState({
          lastOutput: website.preview.lastOutput,
          lastStartedAt: website.preview.lastStartedAt
        })
      };
    });

    if (normalizedWebsites.some((website, index) => website !== this.state.websites[index])) {
      this.state = {
        ...this.state,
        websites: normalizedWebsites
      };
      await this.persist();
    }

    await this.refreshConnections();
    try {
      await this.refreshModels();
    } catch {
      // Leave the last cached model catalog in place if the initial fetch fails.
    }
    return await this.getSnapshot();
  }

  async dispose(): Promise<void> {
    await this.previewManager.dispose();
  }

  async getSnapshot(): Promise<AppSnapshot> {
    return {
      productName: "JJcoder",
      productVersion: app.getVersion(),
      auth: this.authState,
      settings: this.state.settings,
      models: this.state.models,
      modelsFetchedAt: this.state.modelsFetchedAt,
      websites: this.state.websites,
      conversations: this.state.conversations,
      runs: this.state.runs,
      proposedPlans: this.state.proposedPlans,
      pendingUserInputs: this.state.pendingUserInputs
    };
  }

  async refreshModels(): Promise<AppSnapshot> {
    const apiKey = await getOpenRouterApiKey(this.vault);
    const models = await fetchOpenRouterModels(apiKey);
    this.state = {
      ...this.state,
      models,
      modelsFetchedAt: new Date().toISOString()
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async refreshConnections(deep = false): Promise<AppSnapshot> {
    this.authState = await resolveAuthState(this.vault, {
      deepVercelCheck: deep,
      allowBundledRuntime: this.state.settings.useBundledRuntime
    });
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async pickFolder(): Promise<string | null> {
    return null;
  }

  async createWebsite(input: CreateWebsiteInput): Promise<AppSnapshot> {
    const workspacePath = path.resolve(input.workspacePath);
    await fs.mkdir(workspacePath, { recursive: true });
    const directoryEntries = await fs.readdir(workspacePath);
    if (input.scaffold && directoryEntries.length === 0) {
      await scaffoldReactWebsite(workspacePath);
    }

    const website: Website = {
      id: nanoid(),
      name: input.name.trim() || sanitizeProjectName(path.basename(workspacePath)) || "Untitled website",
      description: input.description.trim() || "A website workspace powered by JJcoder.",
      workspacePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      framework: "vite-react-ts",
      homepageHint: "Landing page",
      preview: {
        status: "stopped",
        port: null,
        url: null,
        command: null,
        lastOutput: null,
        lastStartedAt: null
      },
      github: {
        repoName: null,
        repoOwner: null,
        repoUrl: null,
        remoteUrl: null,
        branch: null,
        dirtyFiles: 0,
        lastCommit: null
      },
      vercel: {
        projectName: null,
        projectId: null,
        dashboardUrl: null,
        deploymentId: null,
        deploymentUrl: null,
        target: null,
        lastDeployedAt: null
      },
      conversationIds: [],
      runIds: []
    };

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        selectedWebsiteId: website.id,
        selectedConversationId: null
      },
      websites: [website, ...this.state.websites]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async deleteWebsite(websiteId: string): Promise<AppSnapshot> {
    const website = this.requireWebsite(websiteId);
    const conversationIds = new Set(website.conversationIds);
    const runIds = new Set(
      this.state.runs
        .filter((run) => run.websiteId === websiteId || conversationIds.has(run.conversationId))
        .map((run) => run.id)
    );

    await this.previewManager.stopPreview(websiteId).catch(() => undefined);
    await this.abortAndRejectRuns(runIds, "Project removed");
    this.state = {
      ...this.state,
      websites: this.state.websites.filter((website) => website.id !== websiteId),
      conversations: this.state.conversations.filter((conversation) => conversation.websiteId !== websiteId),
      runs: this.state.runs.filter((run) => run.websiteId !== websiteId),
      proposedPlans: this.state.proposedPlans.filter((plan) => plan.websiteId !== websiteId && !runIds.has(plan.runId)),
      pendingUserInputs: this.state.pendingUserInputs.filter(
        (request) => request.websiteId !== websiteId && !runIds.has(request.runId)
      ),
      settings: {
        ...this.state.settings,
        selectedWebsiteId:
          this.state.settings.selectedWebsiteId === websiteId ? null : this.state.settings.selectedWebsiteId,
        selectedConversationId:
          this.state.conversations.find((conversation) => conversation.id === this.state.settings.selectedConversationId)
            ?.websiteId === websiteId
            ? null
            : this.state.settings.selectedConversationId
      }
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async renameWebsite(input: RenameWebsiteInput): Promise<AppSnapshot> {
    const website = this.requireWebsite(input.websiteId);
    const name = input.name.trim();
    if (!name) {
      throw new Error("Project name cannot be empty.");
    }

    const updatedAt = new Date().toISOString();
    this.state = {
      ...this.state,
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id ? { ...candidate, name, updatedAt } : candidate
      )
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async saveSecret(input: SaveSecretInput): Promise<AppSnapshot> {
    await this.vault.setSecret(input.kind, input.value.trim());
    await this.refreshConnections();
    const snapshot = await this.refreshModels().catch(async () => await this.getSnapshot());
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async clearSecret(kind: SaveSecretInput["kind"]): Promise<AppSnapshot> {
    await this.vault.clearSecret(kind);
    await this.refreshConnections();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async launchProviderLogin(provider: "github" | "vercel"): Promise<void> {
    await launchProviderLogin(provider, {
      allowBundledRuntime: this.state.settings.useBundledRuntime
    });
  }

  async updateSettings(input: UpdateSettingsInput): Promise<AppSnapshot> {
    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        ...input
      }
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async createConversation(input: CreateConversationInput): Promise<AppSnapshot> {
    const website = this.requireWebsite(input.websiteId);
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: nanoid(),
      websiteId: website.id,
      title: input.title?.trim() || "New chat",
      createdAt: now,
      updatedAt: now,
      runIds: []
    };

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        selectedWebsiteId: website.id,
        selectedConversationId: conversation.id,
        conversationSortMode: "manual"
      },
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id
          ? {
              ...candidate,
              conversationIds: [conversation.id, ...candidate.conversationIds],
              updatedAt: now
            }
          : candidate
      ),
      conversations: [conversation, ...this.state.conversations]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async renameConversation(input: RenameConversationInput): Promise<AppSnapshot> {
    const conversation = this.requireConversation(input.conversationId);
    const title = input.title.trim();
    if (!title) {
      throw new Error("Thread name cannot be empty.");
    }

    const updatedAt = new Date().toISOString();
    this.state = {
      ...this.state,
      conversations: this.state.conversations.map((candidate) =>
        candidate.id === conversation.id ? { ...candidate, title, updatedAt } : candidate
      ),
      websites: this.state.websites.map((candidate) =>
        candidate.id === conversation.websiteId ? { ...candidate, updatedAt } : candidate
      )
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async deleteConversation(conversationId: string): Promise<AppSnapshot> {
    const conversation = this.requireConversation(conversationId);
    const runIds = new Set(conversation.runIds);
    const remainingConversations = this.state.conversations.filter((candidate) => candidate.id !== conversationId);
    const nextSelectedConversationId =
      this.state.settings.selectedConversationId === conversationId
        ? remainingConversations.find((candidate) => candidate.websiteId === conversation.websiteId)?.id ?? null
        : this.state.settings.selectedConversationId;

    await this.abortAndRejectRuns(runIds, "Thread deleted");

    this.state = {
      ...this.state,
      websites: this.state.websites.map((candidate) =>
        candidate.id === conversation.websiteId
          ? {
              ...candidate,
              conversationIds: candidate.conversationIds.filter((id) => id !== conversationId),
              runIds: candidate.runIds.filter((id) => !runIds.has(id)),
              updatedAt: new Date().toISOString()
            }
          : candidate
      ),
      conversations: remainingConversations,
      runs: this.state.runs.filter((run) => !runIds.has(run.id)),
      proposedPlans: this.state.proposedPlans.filter((plan) => !runIds.has(plan.runId)),
      pendingUserInputs: this.state.pendingUserInputs.filter((request) => !runIds.has(request.runId)),
      settings: {
        ...this.state.settings,
        selectedConversationId: nextSelectedConversationId,
        selectedWebsiteId: conversation.websiteId
      }
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async reorderWebsites(input: ReorderItemsInput): Promise<AppSnapshot> {
    const orderedIds = input.orderedIds;
    const ordered = orderedIds
      .map((id) => this.state.websites.find((website) => website.id === id))
      .filter((website): website is Website => Boolean(website));
    const remaining = this.state.websites.filter((website) => !orderedIds.includes(website.id));

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        projectSortMode: "manual"
      },
      websites: [...ordered, ...remaining]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async reorderConversations(input: ReorderConversationsInput): Promise<AppSnapshot> {
    const website = this.requireWebsite(input.websiteId);
    const orderedIds = input.orderedIds;
    const scopedConversations = this.state.conversations.filter((conversation) => conversation.websiteId === website.id);
    const ordered = orderedIds
      .map((id) => scopedConversations.find((conversation) => conversation.id === id))
      .filter((conversation): conversation is Conversation => Boolean(conversation));
    const remaining = scopedConversations.filter((conversation) => !orderedIds.includes(conversation.id));
    const nextScoped = [...ordered, ...remaining];

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        conversationSortMode: "manual",
        selectedWebsiteId: website.id
      },
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id
          ? {
              ...candidate,
              conversationIds: nextScoped.map((conversation) => conversation.id)
            }
          : candidate
      ),
      conversations: [
        ...nextScoped,
        ...this.state.conversations.filter((conversation) => conversation.websiteId !== website.id)
      ]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async respondUserInput(input: RespondUserInputInput): Promise<AppSnapshot> {
    const pendingRequest = this.state.pendingUserInputs.find(
      (candidate) => candidate.id === input.requestId && candidate.status === "pending"
    );
    if (!pendingRequest) {
      throw new Error("Pending user input request not found.");
    }

    await this.resolvePendingUserInput(input.requestId, input.answers, new Date().toISOString());
    const resolver = this.pendingUserInputResolvers.get(input.requestId);
    if (resolver) {
      this.pendingUserInputResolvers.delete(input.requestId);
      resolver.resolve(input.answers);
    }

    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async openInIde(websiteId: string): Promise<void> {
    const website = this.requireWebsite(websiteId);
    const result = await runCommand(
      `${this.state.settings.ideCommand} "${website.workspacePath}"`,
      website.workspacePath
    );
    if (result.exitCode !== 0) {
      await shell.openPath(website.workspacePath);
    }
  }

  async openInExplorer(websiteId: string): Promise<void> {
    const website = this.requireWebsite(websiteId);
    await shell.openPath(website.workspacePath);
  }

  async openExternal(url: string): Promise<void> {
    await shell.openExternal(url);
  }

  async startPreview(websiteId: string): Promise<AppSnapshot> {
    const website = this.requireWebsite(websiteId);
    await this.previewManager.startPreview(website, {
      allowBundledRuntime: this.state.settings.useBundledRuntime
    });
    return await this.getSnapshot();
  }

  async stopPreview(websiteId: string): Promise<AppSnapshot> {
    const website = this.requireWebsite(websiteId);
    await this.previewManager.stopPreview(website.id);
    return await this.getSnapshot();
  }

  async initGitRepo(websiteId: string): Promise<AppSnapshot> {
    const website = this.requireWebsite(websiteId);
    await initGitRepository(website.workspacePath);
    const gitState = await readGitState(website);
    this.state = {
      ...this.state,
      websites: this.state.websites.map((candidate) =>
        candidate.id === websiteId ? { ...candidate, github: gitState, updatedAt: new Date().toISOString() } : candidate
      )
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async publishRepo(input: PublishRepoInput): Promise<AppSnapshot> {
    const website = this.requireWebsite(input.websiteId);
    const token = await getGitHubToken(this.vault);
    const gitState = token
      ? await publishGitHubRepository({
          website,
          repoName: input.repoName,
          owner: input.owner,
          githubToken: token
        })
      : await publishGitHubRepositoryWithCli({
          website,
          repoName: input.repoName,
          owner: input.owner
        });
    this.state = {
      ...this.state,
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id ? { ...candidate, github: gitState, updatedAt: new Date().toISOString() } : candidate
      )
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async deployWebsite(input: DeployWebsiteInput): Promise<AppSnapshot> {
    const website = this.requireWebsite(input.websiteId);
    const token = await getVercelToken(this.vault);
    const vercel = token
      ? await deployWebsiteToVercel({
          website,
          token,
          target: input.target,
          allowBundledRuntime: this.state.settings.useBundledRuntime,
          teamId: this.state.settings.vercelTeamId || undefined,
          teamSlug: this.state.settings.vercelTeamSlug || undefined
        })
      : await deployWebsiteToVercelWithCli({
          website,
          allowBundledRuntime: this.state.settings.useBundledRuntime,
          target: input.target
        });
    this.state = {
      ...this.state,
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id ? { ...candidate, vercel, updatedAt: new Date().toISOString() } : candidate
      )
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async dispatchRun(input: DispatchRunInput): Promise<AppSnapshot> {
    const website = this.requireWebsite(input.websiteId);
    const apiKey = await getOpenRouterApiKey(this.vault);
    if (!apiKey) {
      throw new Error("Add an OpenRouter API key in Settings before dispatching an agent.");
    }

    const now = new Date().toISOString();
    let conversation = input.conversationId ? this.state.conversations.find((candidate) => candidate.id === input.conversationId) : null;
    if (conversation && conversation.websiteId !== website.id) {
      throw new Error("Conversation does not belong to the selected project.");
    }
    if (!conversation) {
      conversation = {
        id: nanoid(),
        websiteId: website.id,
        title: this.deriveConversationTitle(input.prompt),
        createdAt: now,
        updatedAt: now,
        runIds: []
      };
    }

    const run: AgentRun = {
      id: nanoid(),
      websiteId: website.id,
      conversationId: conversation.id,
      title: input.prompt.slice(0, 72) || "New build run",
      prompt: input.prompt,
      modelId: input.modelId || this.state.settings.preferredModelId,
      interactionMode: input.interactionMode || this.state.settings.interactionMode,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      summary: null,
      sourcePlanId: input.sourcePlanId ?? null,
      awaitingUserInput: false,
      pendingUserInputRequestId: null,
      events: []
    };

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        selectedWebsiteId: website.id,
        selectedConversationId: conversation.id
      },
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id
          ? {
              ...candidate,
              conversationIds: candidate.conversationIds.includes(conversation.id)
                ? candidate.conversationIds
                : [conversation.id, ...candidate.conversationIds],
              runIds: [run.id, ...candidate.runIds],
              updatedAt: now
            }
          : candidate
      ),
      conversations: this.state.conversations.some((candidate) => candidate.id === conversation.id)
        ? this.state.conversations.map((candidate) =>
            candidate.id === conversation!.id
              ? {
                  ...candidate,
                  title: candidate.runIds.length === 0 ? this.deriveConversationTitle(input.prompt) : candidate.title,
                  runIds: [...candidate.runIds, run.id],
                  updatedAt: now
                }
              : candidate
          )
        : [
            {
              ...conversation,
              runIds: [run.id],
              updatedAt: now
            },
            ...this.state.conversations
          ],
      runs: [run, ...this.state.runs]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    this.emit("run-updated", run);

    const abortController = new AbortController();
    this.runAbortControllers.set(run.id, abortController);

    void this.executeRun(run.id, apiKey, abortController.signal).catch((error) => {
      if (abortController.signal.aborted) return;
      void this.failRun(run.id, error instanceof Error ? error.message : String(error));
    }).finally(() => {
      this.runAbortControllers.delete(run.id);
    });

    return snapshot;
  }

  async cancelRun(runId: string): Promise<AppSnapshot> {
    const abortController = this.runAbortControllers.get(runId);
    if (abortController) {
      abortController.abort();
      this.runAbortControllers.delete(runId);
    }
    // Reject any pending user input for this run
    const run = this.state.runs.find((r) => r.id === runId);
    if (run?.pendingUserInputRequestId) {
      const resolver = this.pendingUserInputResolvers.get(run.pendingUserInputRequestId);
      if (resolver) {
        this.pendingUserInputResolvers.delete(run.pendingUserInputRequestId);
        resolver.reject(new Error("Run cancelled"));
      }
    }
    await this.updateRun(runId, {
      status: "cancelled",
      awaitingUserInput: false,
      pendingUserInputRequestId: null
    });
    await this.appendRunEvent(runId, {
      id: `cancel-${Date.now()}`,
      createdAt: new Date().toISOString(),
      agent: "system",
      type: "status",
      title: "Run cancelled by user",
      content: ""
    });
    return await this.getSnapshot();
  }

  private async executeRun(runId: string, apiKey: string, signal: AbortSignal): Promise<void> {
    await this.updateRun(runId, { status: "running" });
    const run = this.requireRun(runId);
    const website = this.requireWebsite(run.websiteId);
    const conversation = this.requireConversation(run.conversationId);
    const priorRuns = conversation.runIds
      .filter((candidateId) => candidateId !== run.id)
      .map((candidateId) => this.state.runs.find((candidate) => candidate.id === candidateId))
      .filter((candidate): candidate is AgentRun => Boolean(candidate))
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    const summary = await executeWebsiteRun({
      apiKey,
      website,
      conversationHistory: this.buildConversationHistory(priorRuns),
      prompt: run.prompt,
      modelId: run.modelId,
      interactionMode: run.interactionMode,
      allowBundledRuntime: this.state.settings.useBundledRuntime,
      sourcePlanId: run.sourcePlanId,
      signal,
      callbacks: {
        appendEvent: async (event) => {
          signal.throwIfAborted();
          const nextEvent: RunEvent = {
            id: nanoid(),
            createdAt: new Date().toISOString(),
            ...event
          };
          await this.appendRunEvent(runId, nextEvent);
        },
        setStatus: async (status) => {
          signal.throwIfAborted();
          await this.appendRunEvent(runId, {
            id: nanoid(),
            createdAt: new Date().toISOString(),
            agent: "system",
            type: "status",
            title: "Status",
            content: status
          });
        },
        startPreview: async () => {
          signal.throwIfAborted();
          await this.previewManager.startPreview(website, {
            allowBundledRuntime: this.state.settings.useBundledRuntime
          });
        },
        savePlan: async ({ title, planMarkdown }) => {
          signal.throwIfAborted();
          const now = new Date().toISOString();
          const plan: ProposedPlan = {
            id: nanoid(),
            runId,
            websiteId: website.id,
            title,
            planMarkdown,
            createdAt: now,
            updatedAt: now,
            implementedAt: null,
            implementationRunId: null,
            status: "proposed"
          };
          await this.upsertProposedPlan(plan);
          await this.appendRunEvent(runId, {
            id: nanoid(),
            createdAt: now,
            agent: "builder",
            type: "plan",
            title,
            content: planMarkdown,
            metadata: {
              presentation: "plan",
              planId: plan.id
            }
          });
          return plan;
        },
        requestUserInput: async ({ questions }) => {
          signal.throwIfAborted();
          return await this.requestUserInput(runId, website.id, questions);
        }
      }
    });

    signal.throwIfAborted();
    if (run.sourcePlanId) {
      await this.markPlanImplemented(run.sourcePlanId, runId, new Date().toISOString());
    }

    signal.throwIfAborted();
    await this.updateRun(runId, {
      status: "completed",
      awaitingUserInput: false,
      pendingUserInputRequestId: null,
      summary
    });
  }

  private async failRun(runId: string, message: string): Promise<void> {
    const pendingRequestId = this.requireRun(runId).pendingUserInputRequestId;
    if (pendingRequestId) {
      const resolver = this.pendingUserInputResolvers.get(pendingRequestId);
      if (resolver) {
        this.pendingUserInputResolvers.delete(pendingRequestId);
        resolver.reject(new Error(message));
      }
    }
    await this.appendRunEvent(runId, {
      id: nanoid(),
      createdAt: new Date().toISOString(),
      agent: "system",
      type: "error",
      title: "Run failed",
      content: message
    });
    await this.updateRun(runId, {
      status: "failed",
      awaitingUserInput: false,
      pendingUserInputRequestId: null
    });
  }

  private async appendRunEvent(runId: string, event: RunEvent): Promise<void> {
    const run = this.requireRun(runId);
    const nextUpdatedAt = new Date().toISOString();
    const streamKey = typeof event.metadata?.streamKey === "string" ? event.metadata.streamKey : null;
    const replaceExisting = event.metadata?.replace === true && Boolean(streamKey);
    this.state = {
      ...this.state,
      conversations: this.state.conversations.map((candidate) =>
        candidate.id === run.conversationId
          ? {
              ...candidate,
              updatedAt: nextUpdatedAt
            }
          : candidate
      ),
      runs: this.state.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              updatedAt: nextUpdatedAt,
              events: replaceExisting ? this.upsertRunEvent(run.events, event, streamKey!) : [...run.events, event]
            }
          : run
      )
    };
    await this.persist();
    this.emit("run-updated", this.requireRun(runId));
  }

  private async upsertProposedPlan(plan: ProposedPlan): Promise<void> {
    const existingIndex = this.state.proposedPlans.findIndex((candidate) => candidate.id === plan.id);
    this.state = {
      ...this.state,
      proposedPlans:
        existingIndex < 0
          ? [plan, ...this.state.proposedPlans]
          : this.state.proposedPlans.map((candidate, index) => (index === existingIndex ? plan : candidate))
    };
    await this.persist();
    this.emit("snapshot", await this.getSnapshot());
  }

  private async markPlanImplemented(planId: string, implementationRunId: string, implementedAt: string): Promise<void> {
    const nextPlans = this.state.proposedPlans.map((candidate) =>
      candidate.id === planId
        ? {
            ...candidate,
            status: "implemented" as const,
            implementedAt,
            implementationRunId,
            updatedAt: implementedAt
          }
        : candidate
    );
    this.state = {
      ...this.state,
      proposedPlans: nextPlans
    };
    await this.persist();
    this.emit("snapshot", await this.getSnapshot());
  }

  private async requestUserInput(
    runId: string,
    websiteId: string,
    questions: PendingUserInputQuestion[]
  ): Promise<Record<string, string>> {
    const now = new Date().toISOString();
    const requestId = nanoid();
    const pendingRequest: PendingUserInputRequest = {
      id: requestId,
      runId,
      websiteId,
      createdAt: now,
      questions,
      answers: null,
      resolvedAt: null,
      status: "pending"
    };

    await this.openPendingUserInput(pendingRequest);
    await this.appendRunEvent(runId, {
      id: nanoid(),
      createdAt: now,
      agent: "builder",
      type: "user_input",
      title: questions[0]?.header || "User input required",
      content: questions[0]?.question || "The agent is waiting for your answer.",
      metadata: {
        presentation: "user_input",
        requestId
      }
    });

    await this.updateRun(runId, {
      awaitingUserInput: true,
      pendingUserInputRequestId: requestId
    });

    return await new Promise<Record<string, string>>((resolve, reject) => {
      this.pendingUserInputResolvers.set(requestId, {
        runId,
        resolve: async (answers) => {
          await this.appendRunEvent(runId, {
            id: nanoid(),
            createdAt: new Date().toISOString(),
            agent: "system",
            type: "user_input",
            title: "Answered user input",
            content: Object.entries(answers)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n"),
            metadata: {
              presentation: "user_input",
              requestId
            }
          });
          await this.updateRun(runId, {
            awaitingUserInput: false,
            pendingUserInputRequestId: null
          });
          resolve(answers);
        },
        reject
      });
    });
  }

  private async openPendingUserInput(request: PendingUserInputRequest): Promise<void> {
    this.state = {
      ...this.state,
      pendingUserInputs: [request, ...this.state.pendingUserInputs.filter((candidate) => candidate.id !== request.id)]
    };
    await this.persist();
    this.emit("snapshot", await this.getSnapshot());
  }

  private async resolvePendingUserInput(
    requestId: string,
    answers: Record<string, string>,
    resolvedAt: string
  ): Promise<void> {
    this.state = {
      ...this.state,
      pendingUserInputs: this.state.pendingUserInputs.map((candidate) =>
        candidate.id === requestId
          ? {
              ...candidate,
              answers,
              resolvedAt,
              status: "resolved"
            }
          : candidate
      )
    };
    await this.persist();
  }

  private upsertRunEvent(events: RunEvent[], event: RunEvent, streamKey: string): RunEvent[] {
    const existingIndex = events.findIndex(
      (candidate) => typeof candidate.metadata?.streamKey === "string" && candidate.metadata.streamKey === streamKey
    );
    if (existingIndex < 0) {
      return [...events, event];
    }

    return events.map((candidate, index) => (index === existingIndex ? { ...candidate, ...event, id: candidate.id } : candidate));
  }

  private async updateRun(runId: string, patch: Partial<AgentRun>): Promise<void> {
    const existingRun = this.requireRun(runId);
    const nextUpdatedAt = new Date().toISOString();
    this.state = {
      ...this.state,
      conversations: this.state.conversations.map((conversation) =>
        conversation.id === existingRun.conversationId
          ? {
              ...conversation,
              updatedAt: nextUpdatedAt
            }
          : conversation
      ),
      runs: this.state.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              ...patch,
              updatedAt: nextUpdatedAt
            }
          : run
      )
    };
    await this.persist();
    this.emit("run-updated", this.requireRun(runId));
    this.emit("snapshot", await this.getSnapshot());
  }

  private async abortAndRejectRuns(runIds: Set<string>, reason: string): Promise<void> {
    for (const runId of runIds) {
      const abortController = this.runAbortControllers.get(runId);
      if (abortController) {
        abortController.abort();
        this.runAbortControllers.delete(runId);
      }
    }

    for (const [requestId, resolver] of this.pendingUserInputResolvers.entries()) {
      if (!runIds.has(resolver.runId)) {
        continue;
      }
      this.pendingUserInputResolvers.delete(requestId);
      resolver.reject(new Error(reason));
    }
  }

  private deriveConversationTitle(prompt: string): string {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    return normalized.slice(0, 56) || "New chat";
  }

  private buildConversationHistory(runs: AgentRun[]): string {
    if (runs.length === 0) {
      return "";
    }

    return runs
      .map((run, index) => {
        const assistantParts = run.events
          .map((event) => this.extractConversationAssistantText(event))
          .filter((value): value is string => Boolean(value));
        const userInputParts = run.events
          .filter((event) => event.type === "user_input" && event.title === "Answered user input")
          .map((event) => event.content.trim())
          .filter(Boolean);

        return [
          `Turn ${index + 1}:`,
          `User: ${run.prompt}`,
          assistantParts.length > 0 ? `Assistant: ${assistantParts.join("\n\n")}` : null,
          userInputParts.length > 0 ? `Structured input: ${userInputParts.join("\n")}` : null
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }

  private extractConversationAssistantText(event: RunEvent): string | null {
    if (event.type === "assistant" || event.type === "assistant_delta" || event.type === "completion" || event.type === "plan") {
      const trimmed = event.content.trim();
      return trimmed || null;
    }

    const toolName = typeof event.metadata?.toolName === "string" ? event.metadata.toolName : null;
    const toolPhase = typeof event.metadata?.toolPhase === "string" ? event.metadata.toolPhase : null;
    if (event.type !== "tool" || toolName !== "finish_build" || toolPhase !== "result") {
      return null;
    }

    const parsed = this.parseEventJsonRecord(event.content);
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    return summary || null;
  }

  private parseEventJsonRecord(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }

    return null;
  }

  private requireWebsite(websiteId: string): Website {
    const website = this.state.websites.find((candidate) => candidate.id === websiteId);
    if (!website) {
      throw new Error("Website not found.");
    }
    return website;
  }

  private requireRun(runId: string): AgentRun {
    const run = this.state.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw new Error("Run not found.");
    }
    return run;
  }

  private requireConversation(conversationId: string): Conversation {
    const conversation = this.state.conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    return conversation;
  }

  private async persist(): Promise<void> {
    await this.stateStore.save(this.state);
  }
}
