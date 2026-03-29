export type ProviderKind = "openrouter";

export type InteractionMode = "chat" | "plan";
export type SortMode = "recent" | "name" | "manual";

export type DeploymentTarget = "preview" | "production";

export type AuthSource = "vault" | "env" | "github-cli" | "vercel-cli" | null;

export type ProviderLoginKind = "github" | "vercel";

export type PreviewStatus = "stopped" | "starting" | "running" | "error";

export type RunStatus = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";

export type RunEventType =
  | "status"
  | "assistant"
  | "assistant_delta"
  | "tool"
  | "plan"
  | "completion"
  | "user_input"
  | "error";

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
  conversationIds: string[];
  runIds: string[];
}

export interface Conversation {
  id: string;
  websiteId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  runIds: string[];
}

export interface ProposedPlan {
  id: string;
  runId: string;
  websiteId: string;
  title: string;
  planMarkdown: string;
  createdAt: string;
  updatedAt: string;
  implementedAt: string | null;
  implementationRunId: string | null;
  status: "proposed" | "implemented" | "superseded";
}

export interface PendingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: Array<{
    label: string;
    description: string;
  }>;
  allowFreeform: boolean;
}

export interface PendingUserInputRequest {
  id: string;
  runId: string;
  websiteId: string;
  createdAt: string;
  questions: PendingUserInputQuestion[];
  answers: Record<string, string> | null;
  resolvedAt: string | null;
  status: "pending" | "resolved";
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
  conversationId: string;
  title: string;
  prompt: string;
  modelId: string;
  interactionMode: InteractionMode;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  sourcePlanId: string | null;
  awaitingUserInput: boolean;
  pendingUserInputRequestId: string | null;
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
  selectedConversationId: string | null;
  preferredModelId: string;
  interactionMode: InteractionMode;
  projectSortMode: SortMode;
  conversationSortMode: SortMode;
  ideCommand: string;
  websitesRoot: string | null;
  useBundledRuntime: boolean;
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
  conversations: Conversation[];
  runs: AgentRun[];
  proposedPlans: ProposedPlan[];
  pendingUserInputs: PendingUserInputRequest[];
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
  interactionMode?: InteractionMode;
  projectSortMode?: SortMode;
  conversationSortMode?: SortMode;
  ideCommand?: string;
  websitesRoot?: string | null;
  useBundledRuntime?: boolean;
  vercelTeamId?: string;
  vercelTeamSlug?: string;
  onboardingCompletedAt?: string | null;
  selectedWebsiteId?: string | null;
  selectedConversationId?: string | null;
}

export interface DispatchRunInput {
  websiteId: string;
  prompt: string;
  conversationId?: string | null;
  modelId?: string;
  interactionMode?: InteractionMode;
  sourcePlanId?: string | null;
}

export interface CreateConversationInput {
  websiteId: string;
  title?: string;
}

export interface RenameWebsiteInput {
  websiteId: string;
  name: string;
}

export interface RenameConversationInput {
  conversationId: string;
  title: string;
}

export interface ReorderItemsInput {
  orderedIds: string[];
}

export interface ReorderConversationsInput extends ReorderItemsInput {
  websiteId: string;
}

export interface RespondUserInputInput {
  requestId: string;
  answers: Record<string, string>;
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

export interface ShowSidebarContextMenuInput {
  kind: "website" | "conversation";
  websiteId: string;
  websiteName?: string;
  workspacePath?: string;
  conversationId?: string;
  conversationTitle?: string;
}

export interface ContextMenuActionEvent {
  kind: "website" | "conversation";
  action: "rename" | "delete";
  websiteId: string;
  conversationId?: string;
}

export interface UpdateCheckResult {
  checked: boolean;
  message: string;
}

export interface AppEventMap {
  snapshot: AppSnapshot;
  "run-updated": AgentRun;
  "preview-updated": {
    websiteId: string;
    preview: PreviewState;
  };
  "context-menu-action": ContextMenuActionEvent;
}

export interface DesktopBridgeApi {
  getSnapshot: () => Promise<AppSnapshot>;
  pickFolder: () => Promise<string | null>;
  refreshModels: () => Promise<AppSnapshot>;
  refreshConnections: (deep?: boolean) => Promise<AppSnapshot>;
  createWebsite: (input: CreateWebsiteInput) => Promise<AppSnapshot>;
  deleteWebsite: (websiteId: string) => Promise<AppSnapshot>;
  renameWebsite: (input: RenameWebsiteInput) => Promise<AppSnapshot>;
  openInIde: (websiteId: string) => Promise<void>;
  openInExplorer: (websiteId: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  launchProviderLogin: (provider: ProviderLoginKind) => Promise<void>;
  saveSecret: (input: SaveSecretInput) => Promise<AppSnapshot>;
  clearSecret: (kind: SaveSecretInput["kind"]) => Promise<AppSnapshot>;
  updateSettings: (input: UpdateSettingsInput) => Promise<AppSnapshot>;
  createConversation: (input: CreateConversationInput) => Promise<AppSnapshot>;
  renameConversation: (input: RenameConversationInput) => Promise<AppSnapshot>;
  deleteConversation: (conversationId: string) => Promise<AppSnapshot>;
  reorderWebsites: (input: ReorderItemsInput) => Promise<AppSnapshot>;
  reorderConversations: (input: ReorderConversationsInput) => Promise<AppSnapshot>;
  dispatchRun: (input: DispatchRunInput) => Promise<AppSnapshot>;
  respondUserInput: (input: RespondUserInputInput) => Promise<AppSnapshot>;
  startPreview: (websiteId: string) => Promise<AppSnapshot>;
  stopPreview: (websiteId: string) => Promise<AppSnapshot>;
  initGitRepo: (websiteId: string) => Promise<AppSnapshot>;
  publishRepo: (input: PublishRepoInput) => Promise<AppSnapshot>;
  cancelRun: (runId: string) => Promise<AppSnapshot>;
  deployWebsite: (input: DeployWebsiteInput) => Promise<AppSnapshot>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  showSidebarContextMenu: (input: ShowSidebarContextMenuInput) => Promise<void>;
  subscribe: <K extends keyof AppEventMap>(
    channel: K,
    listener: (payload: AppEventMap[K]) => void
  ) => () => void;
}
