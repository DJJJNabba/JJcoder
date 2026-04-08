import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  AppSettings,
  AgentRun,
  Conversation,
  PendingUserInputRequest,
  ProposedPlan,
  ProviderModel,
  Website
} from "@shared/types";
import { ensureDir } from "./utils";

interface PersistedState {
  settings: AppSettings;
  websites: Website[];
  conversations: Conversation[];
  runs: AgentRun[];
  proposedPlans: ProposedPlan[];
  pendingUserInputs: PendingUserInputRequest[];
  models: ProviderModel[];
  modelsFetchedAt: string | null;
}

const DEFAULT_SETTINGS: AppSettings = {
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
};

export class StateStore {
  private readonly stateFilePath: string;
  private readonly backupFilePath: string;

  constructor(baseDirectory: string) {
    this.stateFilePath = path.join(baseDirectory, "state.json");
    this.backupFilePath = path.join(baseDirectory, "state.backup.json");
  }

  async load(): Promise<PersistedState> {
    await ensureDir(path.dirname(this.stateFilePath));
    const loaded = await this.readPersistedState();
    const migrated = migrateLegacyState(loaded);

    return {
      ...migrated,
      websites: migrated.websites ?? [],
      conversations: migrated.conversations ?? [],
      runs: migrated.runs ?? [],
      proposedPlans: migrated.proposedPlans ?? [],
      pendingUserInputs: migrated.pendingUserInputs ?? [],
      models: migrated.models ?? [],
      modelsFetchedAt: migrated.modelsFetchedAt ?? null,
      settings: {
        ...DEFAULT_SETTINGS,
        ...migrated.settings
      }
    };
  }

  async save(value: PersistedState): Promise<void> {
    await ensureDir(path.dirname(this.stateFilePath));
    await fs.copyFile(this.stateFilePath, this.backupFilePath).catch(() => undefined);

    const temporaryPath = path.join(
      path.dirname(this.stateFilePath),
      `state.${process.pid}.${Date.now()}.tmp`
    );
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.stateFilePath).catch(async () => {
      await fs.copyFile(temporaryPath, this.stateFilePath);
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    });
  }

  private async readPersistedState(): Promise<Partial<PersistedState>> {
    const primary = await this.readStateFile(this.stateFilePath);
    if (primary) {
      return primary;
    }

    const backup = await this.readStateFile(this.backupFilePath);
    if (backup) {
      return backup;
    }

    return {
      settings: DEFAULT_SETTINGS,
      websites: [],
      conversations: [],
      runs: [],
      proposedPlans: [],
      pendingUserInputs: [],
      models: [],
      modelsFetchedAt: null
    };
  }

  private async readStateFile(filePath: string): Promise<Partial<PersistedState> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Partial<PersistedState>)
        : null;
    } catch {
      return null;
    }
  }
}

function migrateLegacyState(loaded: Partial<PersistedState>): PersistedState {
  const runs = (loaded.runs ?? []).map((run) => ({ ...run })) as AgentRun[];
  const websites = (loaded.websites ?? []).map((website) => ({ ...website })) as Website[];
  const existingConversations = (loaded.conversations ?? []).map((conversation) => ({ ...conversation })) as Conversation[];

  const conversationsById = new Map(existingConversations.map((conversation) => [conversation.id, conversation]));

  for (const run of runs) {
    const legacyConversationId = (run as AgentRun & { conversationId?: string }).conversationId;
    if (legacyConversationId && conversationsById.has(legacyConversationId)) {
      run.conversationId = legacyConversationId;
      continue;
    }

    const conversationId = nanoid();
    run.conversationId = conversationId;
    conversationsById.set(conversationId, {
      id: conversationId,
      websiteId: run.websiteId,
      title: run.title,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      runIds: [run.id]
    });
  }

  const conversations = [...conversationsById.values()].map((conversation) => ({
    ...conversation,
    runIds: conversation.runIds.length > 0 ? conversation.runIds : runs.filter((run) => run.conversationId === conversation.id).map((run) => run.id)
  }));

  const conversationsByWebsiteId = new Map<string, string[]>();
  for (const conversation of conversations) {
    const next = conversationsByWebsiteId.get(conversation.websiteId) ?? [];
    conversationsByWebsiteId.set(conversation.websiteId, next.includes(conversation.id) ? next : [...next, conversation.id]);
  }

  const normalizedWebsites = websites.map((website) => {
    const conversationIds =
      (website as Website & { conversationIds?: string[] }).conversationIds?.filter((id) => conversationsById.has(id)) ??
      conversationsByWebsiteId.get(website.id) ??
      [];
    const runIds = website.runIds?.length
      ? website.runIds
      : runs.filter((run) => run.websiteId === website.id).map((run) => run.id);
    return {
      ...website,
      conversationIds,
      runIds
    };
  });

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...(loaded.settings ?? {}),
      selectedConversationId:
        (loaded.settings as AppSettings | undefined)?.selectedConversationId ??
        runs.find((run) => run.id === (loaded.settings as AppSettings & { selectedRunId?: string } | undefined)?.selectedRunId)?.conversationId ??
        null
    },
    websites: normalizedWebsites,
    conversations,
    runs,
    proposedPlans: loaded.proposedPlans ?? [],
    pendingUserInputs: loaded.pendingUserInputs ?? [],
    models: loaded.models ?? [],
    modelsFetchedAt: loaded.modelsFetchedAt ?? null
  };
}

export type { PersistedState };
