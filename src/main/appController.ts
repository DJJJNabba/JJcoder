import fs from "node:fs/promises";
import path from "node:path";
import { app, shell } from "electron";
import { nanoid } from "nanoid";
import type {
  AppEventMap,
  AppSnapshot,
  CreateWebsiteInput,
  DeployWebsiteInput,
  DispatchRunInput,
  RunEvent,
  AgentRun,
  PublishRepoInput,
  SaveSecretInput,
  UpdateSettingsInput,
  Website
} from "@shared/types";
import { executeWebsiteAgentRun } from "./services/agent";
import { CredentialVault } from "./services/credentials";
import { initGitRepository, publishGitHubRepository, readGitState } from "./services/git";
import { fetchOpenRouterModels } from "./services/models";
import { StateStore, type PersistedState } from "./services/persistence";
import { PreviewManager } from "./services/preview";
import { scaffoldReactWebsite } from "./services/template";
import { runCommand, sanitizeProjectName } from "./services/utils";
import { deployWebsiteToVercel } from "./services/vercel";

export class AppController {
  private stateStore: StateStore;
  private vault: CredentialVault;
  private previewManager: PreviewManager;
  private state: PersistedState = {
    settings: {
      selectedWebsiteId: null,
      selectedRunId: null,
      preferredModelId: "openrouter/auto",
      agentMode: "squad",
      ideCommand: "code",
      websitesRoot: null,
      vercelTeamId: "",
      vercelTeamSlug: ""
    },
    websites: [],
    runs: [],
    models: [],
    modelsFetchedAt: null
  };

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
    const presence = await this.vault.getPresence();
    return {
      productName: "JJcoder",
      productVersion: app.getVersion(),
      auth: {
        openRouterConfigured: presence.openrouter,
        githubConfigured: presence.github,
        vercelConfigured: presence.vercel,
        encryptionAvailable: presence.encryptionAvailable
      },
      settings: this.state.settings,
      models: this.state.models,
      modelsFetchedAt: this.state.modelsFetchedAt,
      websites: this.state.websites,
      runs: this.state.runs
    };
  }

  async refreshModels(): Promise<AppSnapshot> {
    const apiKey = (await this.vault.getSecret("openrouter")) ?? process.env.OPENROUTER_API_KEY ?? null;
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
      runIds: []
    };

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        selectedWebsiteId: website.id,
        selectedRunId: null
      },
      websites: [website, ...this.state.websites]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async deleteWebsite(websiteId: string): Promise<AppSnapshot> {
    await this.previewManager.stopPreview(websiteId).catch(() => undefined);
    this.state = {
      ...this.state,
      websites: this.state.websites.filter((website) => website.id !== websiteId),
      runs: this.state.runs.filter((run) => run.websiteId !== websiteId),
      settings: {
        ...this.state.settings,
        selectedWebsiteId:
          this.state.settings.selectedWebsiteId === websiteId ? null : this.state.settings.selectedWebsiteId,
        selectedRunId:
          this.state.runs.find((run) => run.id === this.state.settings.selectedRunId)?.websiteId === websiteId
            ? null
            : this.state.settings.selectedRunId
      }
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async saveSecret(input: SaveSecretInput): Promise<AppSnapshot> {
    await this.vault.setSecret(input.kind, input.value.trim());
    const snapshot = await this.refreshModels().catch(async () => await this.getSnapshot());
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  async clearSecret(kind: SaveSecretInput["kind"]): Promise<AppSnapshot> {
    await this.vault.clearSecret(kind);
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
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
    await this.previewManager.startPreview(website);
    return await this.getSnapshot();
  }

  async stopPreview(websiteId: string): Promise<AppSnapshot> {
    await this.previewManager.stopPreview(websiteId);
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
    const token = await this.vault.getSecret("github");
    if (!token) {
      throw new Error("Add a GitHub token in Settings before publishing a repository.");
    }
    const gitState = await publishGitHubRepository({
      website,
      repoName: input.repoName,
      owner: input.owner,
      githubToken: token
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
    const token = await this.vault.getSecret("vercel");
    if (!token) {
      throw new Error("Add a Vercel token in Settings before deploying.");
    }
    const vercel = await deployWebsiteToVercel({
      website,
      token,
      target: input.target,
      teamId: this.state.settings.vercelTeamId || undefined,
      teamSlug: this.state.settings.vercelTeamSlug || undefined
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
    const apiKey = (await this.vault.getSecret("openrouter")) ?? process.env.OPENROUTER_API_KEY ?? null;
    if (!apiKey) {
      throw new Error("Add an OpenRouter API key in Settings before dispatching an agent.");
    }

    const run: AgentRun = {
      id: nanoid(),
      websiteId: website.id,
      title: input.prompt.slice(0, 72) || "New build run",
      prompt: input.prompt,
      modelId: input.modelId || this.state.settings.preferredModelId,
      mode: input.mode || this.state.settings.agentMode,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: null,
      events: []
    };

    this.state = {
      ...this.state,
      settings: {
        ...this.state.settings,
        selectedWebsiteId: website.id,
        selectedRunId: run.id
      },
      websites: this.state.websites.map((candidate) =>
        candidate.id === website.id
          ? {
              ...candidate,
              runIds: [run.id, ...candidate.runIds],
              updatedAt: new Date().toISOString()
            }
          : candidate
      ),
      runs: [run, ...this.state.runs]
    };
    await this.persist();
    const snapshot = await this.getSnapshot();
    this.emit("snapshot", snapshot);
    this.emit("run-updated", run);

    void this.executeRun(run.id, apiKey).catch((error) => {
      void this.failRun(run.id, error instanceof Error ? error.message : String(error));
    });

    return snapshot;
  }

  private async executeRun(runId: string, apiKey: string): Promise<void> {
    await this.updateRun(runId, { status: "running" });
    const run = this.requireRun(runId);
    const website = this.requireWebsite(run.websiteId);

    const summary = await executeWebsiteAgentRun({
      apiKey,
      website,
      prompt: run.prompt,
      modelId: run.modelId,
      mode: run.mode,
      callbacks: {
        appendEvent: async (event) => {
          const nextEvent: RunEvent = {
            id: nanoid(),
            createdAt: new Date().toISOString(),
            ...event
          };
          await this.appendRunEvent(runId, nextEvent);
        },
        setStatus: async (status) => {
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
          await this.previewManager.startPreview(website);
        }
      }
    });

    await this.updateRun(runId, {
      status: "completed",
      summary
    });
  }

  private async failRun(runId: string, message: string): Promise<void> {
    await this.appendRunEvent(runId, {
      id: nanoid(),
      createdAt: new Date().toISOString(),
      agent: "system",
      type: "error",
      title: "Run failed",
      content: message
    });
    await this.updateRun(runId, {
      status: "failed"
    });
  }

  private async appendRunEvent(runId: string, event: RunEvent): Promise<void> {
    this.state = {
      ...this.state,
      runs: this.state.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              updatedAt: new Date().toISOString(),
              events: [...run.events, event]
            }
          : run
      )
    };
    await this.persist();
    this.emit("run-updated", this.requireRun(runId));
  }

  private async updateRun(runId: string, patch: Partial<AgentRun>): Promise<void> {
    this.state = {
      ...this.state,
      runs: this.state.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              ...patch,
              updatedAt: new Date().toISOString()
            }
          : run
      )
    };
    await this.persist();
    this.emit("run-updated", this.requireRun(runId));
    this.emit("snapshot", await this.getSnapshot());
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

  private async persist(): Promise<void> {
    await this.stateStore.save(this.state);
  }
}
