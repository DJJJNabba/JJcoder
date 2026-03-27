import path from "node:path";
import type { AppSettings, AgentRun, ProviderModel, Website } from "@shared/types";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils";

interface PersistedState {
  settings: AppSettings;
  websites: Website[];
  runs: AgentRun[];
  models: ProviderModel[];
  modelsFetchedAt: string | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  selectedWebsiteId: null,
  selectedRunId: null,
  preferredModelId: "openrouter/auto",
  agentMode: "squad",
  ideCommand: "code",
  websitesRoot: null,
  vercelTeamId: "",
  vercelTeamSlug: ""
};

export class StateStore {
  private readonly stateFilePath: string;

  constructor(baseDirectory: string) {
    this.stateFilePath = path.join(baseDirectory, "state.json");
  }

  async load(): Promise<PersistedState> {
    await ensureDir(path.dirname(this.stateFilePath));
    return await readJsonFile<PersistedState>(this.stateFilePath, {
      settings: DEFAULT_SETTINGS,
      websites: [],
      runs: [],
      models: [],
      modelsFetchedAt: null
    });
  }

  async save(value: PersistedState): Promise<void> {
    await writeJsonFile(this.stateFilePath, value);
  }
}

export type { PersistedState };
