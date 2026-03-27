export type ProviderKind = "openrouter";

export type AgentMode = "solo" | "squad";

export type DeploymentTarget = "preview" | "production";

export type AuthSource = "vault" | "env" | "github-cli" | "vercel-cli" | null;

export type ProviderLoginKind = "github" | "vercel";

export type PreviewStatus = "stopped" | "starting" | "running" | "error";

export type RunStatus = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";

export type RunEventType = "status" | "assistant" | "tool" | "error";

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  description: string | null;
  promptPrice: number | null;
  completionPrice: number | null;
  tags: string[];
}

export interface PreviewState {
  status: PreviewStatus;
  port: number | null;
  url: string | null;
  command: string | null;
  lastOutput: string | null;
  lastStartedAt: string | null;
}

export interface GitHubState {
  repoName: string | null;
  repoOwner: string | null;
  repoUrl: string | null;
  remoteUrl: string | null;
  branch: string | null;
  dirtyFiles: number;
  lastCommit: string | null;
}

export interface VercelState {
  projectName: string | null;
  projectId: string | null;
  dashboardUrl: string | null;
  deploymentId: string | null;
  deploymentUrl: string | null;
  target: DeploymentTarget | null;
  lastDeployedAt: string | null;
}

export interface Website {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  framework: "vite-react-ts";
  homepageHint: string;
  preview: PreviewState;
  github: GitHubState;
  vercel: VercelState;
  runIds: string[];
}

export interface RunEvent {
  id: string;
  type: RunEventType;
  createdAt: string;
  agent: "planner" | "builder" | "reviewer" | "system";
  title: string;
  content: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentRun {
  id: string;
  websiteId: string;
  title: string;
  prompt: string;
  modelId: string;
  mode: AgentMode;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  events: RunEvent[];
}

export interface AuthState {
  openRouterConfigured: boolean;
  githubConfigured: boolean;
  vercelConfigured: boolean;
  encryptionAvailable: boolean;
  openRouterSource: AuthSource;
  githubSource: AuthSource;
  vercelSource: AuthSource;
  githubCliInstalled: boolean;
  vercelCliInstalled: boolean;
}

export interface AppSettings {
  selectedWebsiteId: string | null;
  selectedRunId: string | null;
  preferredModelId: string;
  agentMode: AgentMode;
  ideCommand: string;
  websitesRoot: string | null;
  vercelTeamId: string;
  vercelTeamSlug: string;
  onboardingCompletedAt: string | null;
}

export interface AppSnapshot {
  productName: string;
  productVersion: string;
  auth: AuthState;
  settings: AppSettings;
  models: ProviderModel[];
  modelsFetchedAt: string | null;
  websites: Website[];
  runs: AgentRun[];
}

export interface CreateWebsiteInput {
  name: string;
  description: string;
  workspacePath: string;
  scaffold: boolean;
}

export interface SaveSecretInput {
  kind: "openrouter" | "github" | "vercel";
  value: string;
}

export interface UpdateSettingsInput {
  preferredModelId?: string;
  agentMode?: AgentMode;
  ideCommand?: string;
  websitesRoot?: string | null;
  vercelTeamId?: string;
  vercelTeamSlug?: string;
  onboardingCompletedAt?: string | null;
  selectedWebsiteId?: string | null;
  selectedRunId?: string | null;
}

export interface DispatchRunInput {
  websiteId: string;
  prompt: string;
  modelId?: string;
  mode?: AgentMode;
}

export interface PublishRepoInput {
  websiteId: string;
  repoName: string;
  owner?: string;
}

export interface DeployWebsiteInput {
  websiteId: string;
  target: DeploymentTarget;
}

export interface AppEventMap {
  snapshot: AppSnapshot;
  "run-updated": AgentRun;
  "preview-updated": {
    websiteId: string;
    preview: PreviewState;
  };
}

export interface DesktopBridgeApi {
  getSnapshot: () => Promise<AppSnapshot>;
  pickFolder: () => Promise<string | null>;
  refreshModels: () => Promise<AppSnapshot>;
  refreshConnections: (deep?: boolean) => Promise<AppSnapshot>;
  createWebsite: (input: CreateWebsiteInput) => Promise<AppSnapshot>;
  deleteWebsite: (websiteId: string) => Promise<AppSnapshot>;
  openInIde: (websiteId: string) => Promise<void>;
  openInExplorer: (websiteId: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  launchProviderLogin: (provider: ProviderLoginKind) => Promise<void>;
  saveSecret: (input: SaveSecretInput) => Promise<AppSnapshot>;
  clearSecret: (kind: SaveSecretInput["kind"]) => Promise<AppSnapshot>;
  updateSettings: (input: UpdateSettingsInput) => Promise<AppSnapshot>;
  dispatchRun: (input: DispatchRunInput) => Promise<AppSnapshot>;
  startPreview: (websiteId: string) => Promise<AppSnapshot>;
  stopPreview: (websiteId: string) => Promise<AppSnapshot>;
  initGitRepo: (websiteId: string) => Promise<AppSnapshot>;
  publishRepo: (input: PublishRepoInput) => Promise<AppSnapshot>;
  deployWebsite: (input: DeployWebsiteInput) => Promise<AppSnapshot>;
  subscribe: <K extends keyof AppEventMap>(
    channel: K,
    listener: (payload: AppEventMap[K]) => void
  ) => () => void;
}
