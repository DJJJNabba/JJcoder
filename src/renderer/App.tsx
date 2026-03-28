import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronDownIcon,
  GitForkIcon,
  LayoutTemplateIcon,
  PlayIcon,
  RocketIcon,
  Settings2Icon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  WandSparklesIcon
} from "lucide-react";
import type {
  AgentRun,
  AppSnapshot,
  AuthSource,
  ContextMenuActionEvent,
  PendingUserInputRequest,
  ProviderLoginKind,
  ProposedPlan
} from "@shared/types";
import { ModelPicker } from "./components/ModelPicker";
import { PreviewPane } from "./components/PreviewPane";
import { ChatThread } from "./components/ChatThread";
import { WebsiteSidebar } from "./components/WebsiteSidebar";
import { PendingUserInputPanel } from "./components/PendingUserInputPanel";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer
} from "./lib/pendingUserInput";

const EMPTY_SNAPSHOT: AppSnapshot = {
  productName: "JJcoder",
  productVersion: "0.1.0",
  auth: {
    openRouterConfigured: false,
    githubConfigured: false,
    vercelConfigured: false,
    encryptionAvailable: false,
    openRouterSource: null,
    githubSource: null,
    vercelSource: null,
    githubCliInstalled: false,
    vercelCliInstalled: false
  },
  settings: {
    selectedWebsiteId: null,
    selectedConversationId: null,
    preferredModelId: "openrouter/auto",
    interactionMode: "chat",
    projectSortMode: "recent",
    conversationSortMode: "recent",
    ideCommand: "code",
    websitesRoot: null,
    vercelTeamId: "",
    vercelTeamSlug: "",
    onboardingCompletedAt: null
  },
  models: [],
  modelsFetchedAt: null,
  websites: [],
  conversations: [],
  runs: [],
  proposedPlans: [],
  pendingUserInputs: []
};

const SIDEBAR_WIDTH_KEY = "jjcoder.sidebar.width";
const SIDEBAR_COLLAPSED_KEY = "jjcoder.sidebar.collapsed";
const WORKBENCH_WIDTH_KEY = "jjcoder.workbench.left.width";
const DEFAULT_SIDEBAR_WIDTH = 280;
const COLLAPSED_SIDEBAR_WIDTH = 60;
const DEFAULT_WORKBENCH_LEFT_WIDTH = 520;
const MIN_SIDEBAR_WIDTH = 220;
const MIN_WORKBENCH_LEFT_WIDTH = 360;
const MIN_PREVIEW_WIDTH = 320;
const MIN_WORKSPACE_WIDTH = 720;

function readStoredNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function writeStoredNumber(key: string, value: number) {
  window.localStorage.setItem(key, String(Math.round(value)));
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function joinPath(base: string, segment: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${segment.replace(/^[\\/]+/, "")}`;
}

function describeSource(source: AuthSource): string {
  switch (source) {
    case "vault":
      return "stored in app";
    case "env":
      return "loaded from environment";
    case "github-cli":
      return "connected through GitHub CLI";
    case "vercel-cli":
      return "connected through Vercel CLI";
    default:
      return "not connected";
  }
}

type ResizeTarget = "sidebar" | "workbench";

type RenameDialogState =
  | {
      kind: "website";
      websiteId: string;
      value: string;
    }
  | {
      kind: "conversation";
      conversationId: string;
      value: string;
    };

type DeleteDialogState =
  | {
      kind: "website";
      websiteId: string;
      name: string;
    }
  | {
      kind: "conversation";
      conversationId: string;
      name: string;
    };

export function App() {
  const bridge = window.jjcoder;
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWebsite, setShowCreateWebsite] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [createPathTouched, setCreatePathTouched] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [vercelToken, setVercelToken] = useState("");
  const [pendingUserInputAnswers, setPendingUserInputAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [pendingUserInputQuestionIndex, setPendingUserInputQuestionIndex] = useState(0);
  const [respondingUserInput, setRespondingUserInput] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredBoolean(SIDEBAR_COLLAPSED_KEY, false));
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH));
  const [workbenchLeftWidth, setWorkbenchLeftWidth] = useState(() =>
    readStoredNumber(WORKBENCH_WIDTH_KEY, DEFAULT_WORKBENCH_LEFT_WIDTH)
  );
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const workbenchRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{
    target: ResizeTarget;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!bridge) {
      setError("The JJcoder desktop bridge is unavailable. Reload the app or restart Electron.");
      setLoading(false);
      return;
    }

    let disposed = false;
    void bridge
      .getSnapshot()
      .then((next) => {
        if (!disposed) {
          setSnapshot(next);
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    const unsubscribeSnapshot = bridge.subscribe("snapshot", (next) => {
      setSnapshot(next);
    });
    const unsubscribeRun = bridge.subscribe("run-updated", (run) => {
      setSnapshot((prev) => ({
        ...prev,
        runs: [run, ...prev.runs.filter((candidate) => candidate.id !== run.id)]
      }));
    });
    const unsubscribePreview = bridge.subscribe("preview-updated", ({ websiteId, preview }) => {
      setSnapshot((prev) => ({
        ...prev,
        websites: prev.websites.map((website) => (website.id === websiteId ? { ...website, preview } : website))
      }));
    });
    const unsubscribeContextMenu = bridge.subscribe("context-menu-action", (action: ContextMenuActionEvent) => {
      setRenameDialog(null);
      setDeleteDialog(null);

      if (action.kind === "website") {
        const website = snapshot.websites.find((candidate) => candidate.id === action.websiteId);
        if (!website) {
          return;
        }
        if (action.action === "rename") {
          setRenameDialog({
            kind: "website",
            websiteId: website.id,
            value: website.name
          });
          return;
        }
        setDeleteDialog({
          kind: "website",
          websiteId: website.id,
          name: website.name
        });
        return;
      }

      const conversation = snapshot.conversations.find((candidate) => candidate.id === action.conversationId);
      if (!conversation) {
        return;
      }
      if (action.action === "rename") {
        setRenameDialog({
          kind: "conversation",
          conversationId: conversation.id,
          value: conversation.title
        });
        return;
      }
      setDeleteDialog({
        kind: "conversation",
        conversationId: conversation.id,
        name: conversation.title
      });
    });

    return () => {
      disposed = true;
      unsubscribeSnapshot();
      unsubscribeRun();
      unsubscribePreview();
      unsubscribeContextMenu();
    };
  }, [bridge, snapshot.conversations, snapshot.websites]);

  useEffect(() => {
    const needsOnboarding =
      !loading &&
      !snapshot.settings.onboardingCompletedAt &&
      (!snapshot.auth.openRouterConfigured || snapshot.websites.length === 0);
    setShowOnboarding(needsOnboarding);
  }, [loading, snapshot.auth.openRouterConfigured, snapshot.settings.onboardingCompletedAt, snapshot.websites.length]);

  useEffect(() => {
    if (!showCreateWebsite || createPathTouched || createPath.trim() || !snapshot.settings.websitesRoot) {
      return;
    }
    const segment = sanitizeSegment(createName) || "my-website";
    setCreatePath(joinPath(snapshot.settings.websitesRoot, segment));
  }, [createName, createPath, createPathTouched, showCreateWebsite, snapshot.settings.websitesRoot]);

  useEffect(() => {
    const stopResize = () => {
      if (!resizeRef.current) {
        return;
      }

      const { target, currentWidth } = resizeRef.current;
      if (target === "sidebar") {
        writeStoredNumber(SIDEBAR_WIDTH_KEY, currentWidth);
      } else {
        writeStoredNumber(WORKBENCH_WIDTH_KEY, currentWidth);
      }
      resizeRef.current = null;
      document.body.classList.remove("is-resizing");
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) {
        return;
      }
      if (event.buttons === 0) {
        stopResize();
        return;
      }

      if (resizeRef.current.target === "sidebar") {
        const totalWidth = appShellRef.current?.clientWidth ?? 0;
        const nextWidth = clamp(
          resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX),
          MIN_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, totalWidth - MIN_WORKSPACE_WIDTH)
        );
        resizeRef.current.currentWidth = nextWidth;
        setSidebarWidth(nextWidth);
        return;
      }

      const totalWidth = workbenchRef.current?.clientWidth ?? 0;
      const nextWidth = clamp(
        resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX),
        MIN_WORKBENCH_LEFT_WIDTH,
        Math.max(MIN_WORKBENCH_LEFT_WIDTH, totalWidth - MIN_PREVIEW_WIDTH)
      );
      resizeRef.current.currentWidth = nextWidth;
      setWorkbenchLeftWidth(nextWidth);
    };

    const handlePointerUp = () => stopResize();
    const handleWindowBlur = () => stopResize();

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("blur", handleWindowBlur);
      stopResize();
    };
  }, []);

  const selectedWebsite = useMemo(() => {
    return snapshot.websites.find((website) => website.id === snapshot.settings.selectedWebsiteId) ?? null;
  }, [snapshot.settings.selectedWebsiteId, snapshot.websites]);

  const activeWebsite = selectedWebsite ?? snapshot.websites[0] ?? null;
  const previewStatus = activeWebsite?.preview.status ?? "stopped";
  const previewPaneVisible = Boolean(activeWebsite && previewStatus !== "stopped");
  const previewRunning = previewStatus === "starting" || previewStatus === "running";

  useEffect(() => {
    const clampStoredWidths = () => {
      const totalShellWidth = appShellRef.current?.clientWidth ?? 0;
      const totalWorkbenchWidth = workbenchRef.current?.clientWidth ?? 0;

      if (totalShellWidth > 0) {
        const clampedSidebarWidth = clamp(
          sidebarWidth,
          MIN_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, totalShellWidth - MIN_WORKSPACE_WIDTH)
        );
        if (clampedSidebarWidth !== sidebarWidth) {
          setSidebarWidth(clampedSidebarWidth);
          writeStoredNumber(SIDEBAR_WIDTH_KEY, clampedSidebarWidth);
        }
      }

      if (previewPaneVisible && totalWorkbenchWidth > 0) {
        const clampedWorkbenchWidth = clamp(
          workbenchLeftWidth,
          MIN_WORKBENCH_LEFT_WIDTH,
          Math.max(MIN_WORKBENCH_LEFT_WIDTH, totalWorkbenchWidth - MIN_PREVIEW_WIDTH)
        );
        if (clampedWorkbenchWidth !== workbenchLeftWidth) {
          setWorkbenchLeftWidth(clampedWorkbenchWidth);
          writeStoredNumber(WORKBENCH_WIDTH_KEY, clampedWorkbenchWidth);
        }
      }
    };

    let resizeClassTimer: ReturnType<typeof setTimeout> | null = null;
    const handleWindowResize = () => {
      document.body.classList.add("is-window-resizing");
      if (resizeClassTimer !== null) {
        clearTimeout(resizeClassTimer);
      }
      resizeClassTimer = setTimeout(() => {
        document.body.classList.remove("is-window-resizing");
        resizeClassTimer = null;
      }, 140);
      clampStoredWidths();
    };

    clampStoredWidths();
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (resizeClassTimer !== null) {
        clearTimeout(resizeClassTimer);
      }
      document.body.classList.remove("is-window-resizing");
    };
  }, [previewPaneVisible, sidebarWidth, workbenchLeftWidth]);

  const activeWebsiteConversations = useMemo(() => {
    if (!activeWebsite) return [];
    const conversations = snapshot.conversations.filter((conversation) => conversation.websiteId === activeWebsite.id);
    const manualOrder = new Map(activeWebsite.conversationIds.map((id, index) => [id, index]));

    switch (snapshot.settings.projectSortMode) {
      case "name":
        return [...conversations].sort((left, right) => left.title.localeCompare(right.title));
      case "manual":
        return [...conversations].sort(
          (left, right) => (manualOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (manualOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        );
      default:
        return [...conversations].sort(
          (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
    }
  }, [activeWebsite, snapshot.conversations, snapshot.settings.projectSortMode]);

  const selectedConversation = useMemo(() => {
    const selectedId = snapshot.settings.selectedConversationId;
    if (!selectedId) {
      return activeWebsiteConversations[0] ?? null;
    }
    return snapshot.conversations.find((conversation) => conversation.id === selectedId) ?? activeWebsiteConversations[0] ?? null;
  }, [activeWebsiteConversations, snapshot.conversations, snapshot.settings.selectedConversationId]);

  const activeConversationRuns = useMemo(() => {
    if (!selectedConversation) return [];
    const runsById = new Map(snapshot.runs.map((run) => [run.id, run]));
    return selectedConversation.runIds
      .map((runId) => runsById.get(runId))
      .filter((run): run is AgentRun => Boolean(run))
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }, [selectedConversation, snapshot.runs]);

  const activePlan = useMemo<ProposedPlan | null>(() => {
    const selectedRun = activeConversationRuns[activeConversationRuns.length - 1];
    if (!selectedRun) return null;
    return (
      (snapshot.proposedPlans ?? []).find(
        (plan) => plan.runId === selectedRun.id && (plan.status === "proposed" || plan.status === "implemented")
      ) ?? null
    );
  }, [activeConversationRuns, snapshot.proposedPlans]);

  const activePendingUserInput = useMemo<PendingUserInputRequest | null>(() => {
    const pendingRunIds = new Set(activeConversationRuns.map((run) => run.id));
    return (
      (snapshot.pendingUserInputs ?? []).find(
        (request) => pendingRunIds.has(request.runId) && request.status === "pending"
      ) ?? null
    );
  }, [activeConversationRuns, snapshot.pendingUserInputs]);

  const activePendingUserInputProgress = useMemo(() => {
    if (!activePendingUserInput) return null;
    return derivePendingUserInputProgress(
      activePendingUserInput.questions,
      pendingUserInputAnswers,
      pendingUserInputQuestionIndex
    );
  }, [activePendingUserInput, pendingUserInputAnswers, pendingUserInputQuestionIndex]);

  const isAgentRunning = useMemo(() => {
    return activeConversationRuns.some((run) => run.status === "running" || run.status === "queued");
  }, [activeConversationRuns]);

  const activeRunId = useMemo(() => {
    const running = activeConversationRuns.find((run) => run.status === "running" || run.status === "queued");
    return running?.id ?? null;
  }, [activeConversationRuns]);

  useEffect(() => {
    setPendingUserInputAnswers({});
    setPendingUserInputQuestionIndex(0);
  }, [activePendingUserInput?.id]);

  const handleError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  };

  const mutateSnapshot = async (callback: () => Promise<AppSnapshot>) => {
    try {
      const next = await callback();
      setSnapshot(next);
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const saveTokens = async () => {
    await mutateSnapshot(async () => {
      let next = snapshot;
      if (openrouterKey.trim()) {
        next = await window.jjcoder.saveSecret({ kind: "openrouter", value: openrouterKey });
      }
      if (githubToken.trim()) {
        next = await window.jjcoder.saveSecret({ kind: "github", value: githubToken });
      }
      if (vercelToken.trim()) {
        next = await window.jjcoder.saveSecret({ kind: "vercel", value: vercelToken });
      }
      next = await window.jjcoder.updateSettings({
        ideCommand: snapshot.settings.ideCommand,
        vercelTeamId: snapshot.settings.vercelTeamId,
        vercelTeamSlug: snapshot.settings.vercelTeamSlug,
        websitesRoot: snapshot.settings.websitesRoot,
        onboardingCompletedAt: snapshot.settings.onboardingCompletedAt
      });
      setOpenrouterKey("");
      setGithubToken("");
      setVercelToken("");
      return await window.jjcoder.refreshConnections(true).catch(async () => next);
    });
  };

  const completeOnboarding = async () => {
    await mutateSnapshot(async () => {
      return await window.jjcoder.updateSettings({
        onboardingCompletedAt: new Date().toISOString()
      });
    });
    setShowOnboarding(false);
  };

  const refreshConnections = async (deep = true) => {
    await mutateSnapshot(async () => await window.jjcoder.refreshConnections(deep));
  };

  const launchProviderLogin = async (provider: ProviderLoginKind) => {
    try {
      await window.jjcoder.launchProviderLogin(provider);
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const selectWebsite = async (websiteId: string) => {
    await mutateSnapshot(async () => {
      const currentSelectedConversation = snapshot.conversations.find(
        (conversation) => conversation.id === snapshot.settings.selectedConversationId
      );
      const nextConversation =
        currentSelectedConversation?.websiteId === websiteId
          ? currentSelectedConversation.id
          : snapshot.conversations.find((conversation) => conversation.websiteId === websiteId)?.id ?? null;
      return await window.jjcoder.updateSettings({
        selectedWebsiteId: websiteId,
        selectedConversationId: nextConversation
      });
    });
  };

  const selectConversation = async (conversationId: string, websiteId: string) => {
    await mutateSnapshot(async () => {
      return await window.jjcoder.updateSettings({
        selectedWebsiteId: websiteId,
        selectedConversationId: conversationId
      });
    });
  };

  const createConversation = async (websiteId: string) => {
    await mutateSnapshot(async () => await window.jjcoder.createConversation({ websiteId }));
  };

  const showWebsiteContextMenu = async (websiteId: string) => {
    const website = snapshot.websites.find((candidate) => candidate.id === websiteId);
    if (!website) {
      return;
    }

    try {
      await window.jjcoder.showSidebarContextMenu({
        kind: "website",
        websiteId: website.id,
        websiteName: website.name,
        workspacePath: website.workspacePath
      });
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const showConversationContextMenu = async (conversationId: string, websiteId: string) => {
    const conversation = snapshot.conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      return;
    }

    try {
      await window.jjcoder.showSidebarContextMenu({
        kind: "conversation",
        websiteId,
        conversationId: conversation.id,
        conversationTitle: conversation.title
      });
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const submitRename = async () => {
    if (!renameDialog) {
      return;
    }

    const nextValue = renameDialog.value.trim();
    if (!nextValue) {
      setError(renameDialog.kind === "website" ? "Project name cannot be empty." : "Thread name cannot be empty.");
      return;
    }

    await mutateSnapshot(async () => {
      const next =
        renameDialog.kind === "website"
          ? await window.jjcoder.renameWebsite({ websiteId: renameDialog.websiteId, name: nextValue })
          : await window.jjcoder.renameConversation({ conversationId: renameDialog.conversationId, title: nextValue });
      setRenameDialog(null);
      return next;
    });
  };

  const confirmDelete = async () => {
    if (!deleteDialog) {
      return;
    }

    await mutateSnapshot(async () => {
      const next =
        deleteDialog.kind === "website"
          ? await window.jjcoder.deleteWebsite(deleteDialog.websiteId)
          : await window.jjcoder.deleteConversation(deleteDialog.conversationId);
      setDeleteDialog(null);
      return next;
    });
  };

  const createWebsite = async () => {
    const normalizedCreatePath = createPath.trim()
      ? createPath.trim()
      : snapshot.settings.websitesRoot && createName.trim()
        ? joinPath(snapshot.settings.websitesRoot, sanitizeSegment(createName) || "my-website")
        : "";

    if (!normalizedCreatePath) {
      setError("Choose a workspace folder before creating a website.");
      return;
    }

    await mutateSnapshot(async () => {
      const next = await window.jjcoder.createWebsite({
        name: createName,
        description: createDescription,
        workspacePath: normalizedCreatePath,
        scaffold: true
      });
      const completed = await window.jjcoder.updateSettings({
        onboardingCompletedAt: next.settings.onboardingCompletedAt ?? new Date().toISOString()
      });
      setShowCreateWebsite(false);
      setShowOnboarding(false);
      setCreateName("");
      setCreateDescription("");
      setCreatePath("");
      setCreatePathTouched(false);
      return completed;
    });
  };

  const dispatchRun = async () => {
    if (!activeWebsite) {
      return;
    }

    if (activePendingUserInput) {
      const answers = buildPendingUserInputAnswers(activePendingUserInput.questions, pendingUserInputAnswers);
      if (!answers) {
        setError("Answer the current question before continuing.");
        return;
      }
      try {
        setRespondingUserInput(true);
        await window.jjcoder.respondUserInput({
          requestId: activePendingUserInput.id,
          answers
        });
        setPrompt("");
        setPendingUserInputAnswers({});
        setPendingUserInputQuestionIndex(0);
        setError(null);
      } catch (reason) {
        handleError(reason);
      } finally {
        setRespondingUserInput(false);
      }
      return;
    }

    if (activePlan && activePlan.status === "proposed") {
      const trimmedPrompt = prompt.trim();
      try {
        if (trimmedPrompt) {
          await window.jjcoder.dispatchRun({
            websiteId: activeWebsite.id,
            conversationId: selectedConversation?.id ?? null,
            prompt: trimmedPrompt,
            interactionMode: "plan"
          });
        } else {
          await window.jjcoder.dispatchRun({
            websiteId: activeWebsite.id,
            conversationId: selectedConversation?.id ?? null,
            prompt: `PLEASE IMPLEMENT THIS PLAN:\n${activePlan.planMarkdown}`,
            interactionMode: "chat",
            sourcePlanId: activePlan.id
          });
        }
        setPrompt("");
        setError(null);
      } catch (reason) {
        handleError(reason);
      }
      return;
    }

    if (!prompt.trim()) {
      return;
    }

    try {
      await window.jjcoder.dispatchRun({
        websiteId: activeWebsite.id,
        conversationId: selectedConversation?.id ?? null,
        prompt: prompt.trim(),
        interactionMode: snapshot.settings.interactionMode
      });
      setPrompt("");
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const implementPlan = async () => {
    if (!activeWebsite || !activePlan || activePlan.status !== "proposed") {
      return;
    }
    try {
      await window.jjcoder.dispatchRun({
        websiteId: activeWebsite.id,
        conversationId: selectedConversation?.id ?? null,
        prompt: `PLEASE IMPLEMENT THIS PLAN:\n${activePlan.planMarkdown}`,
        interactionMode: "chat",
        sourcePlanId: activePlan.id
      });
      setPrompt("");
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const cancelCurrentRun = async () => {
    if (!activeRunId) return;
    try {
      const next = await window.jjcoder.cancelRun(activeRunId);
      setSnapshot(next);
      setError(null);
    } catch (reason) {
      handleError(reason);
    }
  };

  const handleSelectPendingOption = (questionId: string, optionLabel: string) => {
    setPendingUserInputAnswers((prev) => ({
      ...prev,
      [questionId]: {
        selectedOptionLabel: optionLabel
      }
    }));
  };

  const handleAdvancePendingInput = () => {
    if (!activePendingUserInput || !activePendingUserInputProgress) {
      return;
    }
    if (activePendingUserInputProgress.isLastQuestion) {
      void dispatchRun();
      return;
    }
    setPendingUserInputQuestionIndex((prev) => Math.min(prev + 1, activePendingUserInput.questions.length - 1));
  };

  const beginResize = (target: ResizeTarget) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (target === "sidebar" && sidebarCollapsed) {
      return;
    }
    resizeRef.current = {
      target,
      startX: event.clientX,
      startWidth: target === "sidebar" ? sidebarWidth : workbenchLeftWidth,
      currentWidth: target === "sidebar" ? sidebarWidth : workbenchLeftWidth
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  };

  if (!bridge) {
    return (
      <div className="app-shell">
        <main className="workspace-shell">
          <div className="empty-panel">
            <p className="eyebrow">Bridge Error</p>
            <h2>JJcoder could not connect to the desktop preload bridge</h2>
            <p>
              The renderer loaded, but <code>window.jjcoder</code> was not injected. Restart the app. If this keeps
              happening, check the Electron preload path and main-process logs.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      ref={appShellRef}
      className="app-shell"
      style={{
        gridTemplateColumns: `${sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth}px var(--divider-size) minmax(0, 1fr)`
      }}
    >
      <WebsiteSidebar
        websites={snapshot.websites}
        conversations={snapshot.conversations}
        runs={snapshot.runs}
        collapsed={sidebarCollapsed}
        projectSortMode={snapshot.settings.projectSortMode}
        selectedWebsiteId={snapshot.settings.selectedWebsiteId}
        selectedConversationId={snapshot.settings.selectedConversationId}
        onSelectWebsite={(websiteId) => void selectWebsite(websiteId)}
        onSelectConversation={(conversationId, websiteId) => void selectConversation(conversationId, websiteId)}
        onCreateConversation={(websiteId) => void createConversation(websiteId)}
        onChangeProjectSortMode={(sortMode) =>
          void mutateSnapshot(async () => await window.jjcoder.updateSettings({ projectSortMode: sortMode }))
        }
        onReorderWebsites={(orderedIds) => void mutateSnapshot(async () => await window.jjcoder.reorderWebsites({ orderedIds }))}
        onReorderConversations={(websiteId, orderedIds) =>
          void mutateSnapshot(async () => await window.jjcoder.reorderConversations({ websiteId, orderedIds }))
        }
        onCreateWebsite={() => setShowCreateWebsite(true)}
        onRequestWebsiteContextMenu={(website) => void showWebsiteContextMenu(website.id)}
        onRequestConversationContextMenu={(website, conversation) =>
          void showConversationContextMenu(conversation.id, website.id)
        }
        onToggleCollapse={() => {
          const next = !sidebarCollapsed;
          setSidebarCollapsed(next);
          window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
        }}
      />

      <div
        className={`panel-divider ${sidebarCollapsed ? "disabled" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={beginResize("sidebar")}
        onDoubleClick={() => {
          setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
          writeStoredNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
        }}
      />

      <main className="workspace-shell">
        <header className="workspace-header">
          <div>
            <h2>{activeWebsite?.name ?? "JJcoder"}</h2>
            <span className="header-caption">
              {activeWebsite ? `${activeWebsite.workspacePath}` : "Run the guided setup to create your first website"}
            </span>
          </div>
          <div className="header-actions">
            <button type="button" className="toolbar-chip" onClick={() => setShowOnboarding(true)}>
              <WandSparklesIcon size={13} />
              Setup
            </button>
            <button type="button" className="icon-button" onClick={() => setShowSettings(true)} title="Settings">
              <Settings2Icon size={14} />
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="status-bar">
          <div className="status-item">
            <span className={`status-dot ${snapshot.auth.openRouterConfigured ? "ready" : "missing"}`} />
            OpenRouter
            <span className="status-detail">{describeSource(snapshot.auth.openRouterSource)}</span>
          </div>
          <div className="status-item">
            <span className={`status-dot ${snapshot.auth.githubConfigured ? "ready" : "missing"}`} />
            GitHub
            <span className="status-detail">{describeSource(snapshot.auth.githubSource)}</span>
          </div>
          <div className="status-item">
            <span className={`status-dot ${snapshot.auth.vercelConfigured ? "ready" : "missing"}`} />
            Vercel
            <span className="status-detail">{describeSource(snapshot.auth.vercelSource)}</span>
          </div>
          <div className="status-item">
            <span className={`status-dot ${activeWebsite?.github.repoUrl ? "ready" : "pending"}`} />
            {activeWebsite?.github.repoUrl ? "Repo linked" : "No repo"}
          </div>
          <div className="status-item">
            <span className={`status-dot ${activeWebsite?.vercel.deploymentUrl ? "ready" : "pending"}`} />
            {activeWebsite?.vercel.deploymentUrl ? "Deployed" : "Not deployed"}
          </div>
          <button type="button" className="text-button status-refresh" onClick={() => void refreshConnections(true)}>
            Refresh setup
          </button>
          <div className="status-spacer">{snapshot.models.length} models</div>
        </div>

        <section className="workspace-toolbar">
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite}
            onClick={() => activeWebsite && void window.jjcoder.openInIde(activeWebsite.id).catch(handleError)}
          >
            <LayoutTemplateIcon size={13} />
            IDE
          </button>
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite}
            onClick={() =>
              activeWebsite &&
              void window.jjcoder.initGitRepo(activeWebsite.id).then(setSnapshot).catch(handleError)
            }
          >
            <GitForkIcon size={13} />
            Init Git
          </button>
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite}
            onClick={() =>
              activeWebsite &&
              void window.jjcoder
                .publishRepo({
                  websiteId: activeWebsite.id,
                  repoName: repoName || activeWebsite.name
                })
                .then(setSnapshot)
                .catch(handleError)
            }
          >
            <GitForkIcon size={13} />
            Publish
          </button>
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite?.github.repoUrl}
            onClick={() =>
              activeWebsite?.github.repoUrl &&
              void window.jjcoder.openExternal(activeWebsite.github.repoUrl).catch(handleError)
            }
          >
            <GitForkIcon size={13} />
            GitHub
          </button>
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite}
            onClick={() =>
              activeWebsite &&
              void window.jjcoder
                .deployWebsite({
                  websiteId: activeWebsite.id,
                  target: "production"
                })
                .then(setSnapshot)
                .catch(handleError)
            }
          >
            <RocketIcon size={13} />
            Deploy
          </button>
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite}
            onClick={() =>
              activeWebsite &&
              void window.jjcoder
                [previewRunning ? "stopPreview" : "startPreview"](activeWebsite.id)
                .then(setSnapshot)
                .catch(handleError)
            }
          >
            {previewRunning ? <SquareIcon size={13} /> : <PlayIcon size={13} />}
            {previewRunning ? "Stop preview" : "Preview"}
          </button>
          <label className="inline-field">
            <span>Repo</span>
            <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="repo-name" />
          </label>
        </section>

        <section
          ref={workbenchRef}
          className={`workbench-grid ${previewPaneVisible ? "preview-visible" : "preview-hidden"}`}
          style={{
            gridTemplateColumns: previewPaneVisible
              ? `${workbenchLeftWidth}px var(--divider-size) minmax(${MIN_PREVIEW_WIDTH}px, 1fr)`
              : "minmax(0, 1fr)"
          }}
        >
          <div className="left-column">
            <div className="left-column-shell">
              <div className="chat-plan-shell">
                <ChatThread runs={activeConversationRuns} />
              </div>

              <div className="composer-area">
                <PendingUserInputPanel
                  request={activePendingUserInput}
                  answers={pendingUserInputAnswers}
                  questionIndex={pendingUserInputQuestionIndex}
                  isResponding={respondingUserInput}
                  onSelectOption={handleSelectPendingOption}
                  onAdvance={handleAdvancePendingInput}
                />
                <textarea
                  value={prompt}
                  disabled={isAgentRunning && !activePendingUserInput}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    if (activePendingUserInputProgress?.activeQuestion?.allowFreeform) {
                      const question = activePendingUserInputProgress.activeQuestion;
                      setPendingUserInputAnswers((prev) => ({
                        ...prev,
                        [question.id]: setPendingUserInputCustomAnswer(prev[question.id], event.target.value)
                      }));
                    }
                  }}
                  placeholder={
                    isAgentRunning && !activePendingUserInput
                      ? "Agent is working..."
                      : activePendingUserInputProgress?.activeQuestion?.allowFreeform
                        ? "Type a custom answer or choose an option..."
                        : activePlan && activePlan.status === "proposed"
                          ? "Add refinements, or leave empty to implement the plan..."
                          : "Describe what to build..."
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      if (!isAgentRunning || activePendingUserInput) {
                        void dispatchRun();
                      }
                    }
                    if (!activePendingUserInput || event.metaKey || event.ctrlKey || event.altKey) {
                      return;
                    }
                    const digit = Number.parseInt(event.key, 10);
                    if (Number.isNaN(digit) || digit < 1 || digit > 9) {
                      return;
                    }
                    const question = activePendingUserInputProgress?.activeQuestion;
                    const option = question?.options[digit - 1];
                    if (!question || !option) {
                      return;
                    }
                    event.preventDefault();
                    handleSelectPendingOption(question.id, option.label);
                    window.setTimeout(() => {
                      handleAdvancePendingInput();
                    }, 200);
                  }}
                />
                <div className="composer-footer">
                  <div className="composer-left-controls">
                    <ModelPicker
                      models={snapshot.models}
                      selectedModelId={snapshot.settings.preferredModelId}
                      onSelect={(modelId) => {
                        void mutateSnapshot(async () => await window.jjcoder.updateSettings({ preferredModelId: modelId }));
                      }}
                    />
                    <div className="segmented">
                      <button
                        type="button"
                        className={snapshot.settings.interactionMode === "chat" ? "active" : ""}
                        onClick={() => {
                          void mutateSnapshot(async () => await window.jjcoder.updateSettings({ interactionMode: "chat" }));
                        }}
                      >
                        Chat
                      </button>
                      <button
                        type="button"
                        className={snapshot.settings.interactionMode === "plan" ? "active" : ""}
                        onClick={() => {
                          void mutateSnapshot(async () => await window.jjcoder.updateSettings({ interactionMode: "plan" }));
                        }}
                      >
                        Plan
                      </button>
                    </div>
                  </div>
                  <div className="composer-actions">
                    {activePlan && activePlan.status === "proposed" && !prompt.trim() && !isAgentRunning ? (
                      <button type="button" className="toolbar-chip" onClick={() => void implementPlan()}>
                        <ChevronDownIcon size={13} />
                        Implement plan
                      </button>
                    ) : null}
                    {isAgentRunning && !activePendingUserInput ? (
                      <button
                        type="button"
                        className="stop-button"
                        onClick={() => void cancelCurrentRun()}
                      >
                        <SquareIcon size={11} />
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          !activeWebsite ||
                          (activePendingUserInput
                            ? !activePendingUserInputProgress?.canAdvance && !activePendingUserInputProgress?.isComplete
                            : !prompt.trim() && !(activePlan && activePlan.status === "proposed"))
                        }
                        onClick={() => void dispatchRun()}
                      >
                        <SendIcon size={13} />
                        {activePendingUserInput
                          ? activePendingUserInputProgress?.isLastQuestion
                            ? "Submit answers"
                            : "Next question"
                          : activePlan && activePlan.status === "proposed"
                            ? prompt.trim()
                              ? "Refine"
                              : "Implement"
                            : "Send"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {previewPaneVisible ? (
            <div
              className="panel-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize workbench"
              onPointerDown={beginResize("workbench")}
              onDoubleClick={() => {
                setWorkbenchLeftWidth(DEFAULT_WORKBENCH_LEFT_WIDTH);
                writeStoredNumber(WORKBENCH_WIDTH_KEY, DEFAULT_WORKBENCH_LEFT_WIDTH);
              }}
            />
          ) : null}

          {previewPaneVisible ? (
            <PreviewPane
              website={activeWebsite}
              onStartPreview={(websiteId) =>
                void window.jjcoder.startPreview(websiteId).then(setSnapshot).catch(handleError)
              }
              onStopPreview={(websiteId) =>
                void window.jjcoder.stopPreview(websiteId).then(setSnapshot).catch(handleError)
              }
              onOpenExternal={(url) => void window.jjcoder.openExternal(url).catch(handleError)}
            />
          ) : null}
        </section>
      </main>

      {showOnboarding ? (
        <div className="overlay">
          <div className="dialog onboarding-dialog">
            <header className="onboarding-header">
              <div>
                <p className="eyebrow">Welcome</p>
                <h2>Get JJcoder ready in a few minutes</h2>
              </div>
              <button type="button" className="toolbar-chip" onClick={() => void completeOnboarding()}>
                Skip onboarding
              </button>
            </header>

            <div className="onboarding-intro">
              <div className="onboarding-step">
                <strong>1. Connect your tools</strong>
                <p>JJcoder can reuse existing GitHub CLI, Vercel CLI, and environment-based credentials so users do not have to paste everything manually.</p>
              </div>
              <div className="onboarding-step">
                <strong>2. Pick a workspace folder</strong>
                <p>Choose one root folder for new websites and JJcoder will scaffold a Vite + React workspace inside it.</p>
              </div>
              <div className="onboarding-step">
                <strong>3. Create, publish, deploy</strong>
                <p>Write a prompt, let the agent build, then publish to GitHub and deploy to Vercel from the same app.</p>
              </div>
            </div>

            <div className="onboarding-grid">
              <section className="setup-card">
                <div className="setup-card-header">
                  <div>
                    <p className="eyebrow">AI access</p>
                    <h3>OpenRouter</h3>
                  </div>
                  <span className={`status-pill ${snapshot.auth.openRouterConfigured ? "status-completed" : "status-queued"}`}>
                    {snapshot.auth.openRouterConfigured ? describeSource(snapshot.auth.openRouterSource) : "required"}
                  </span>
                </div>
                <p>Needed for agent runs. If `OPENROUTER_API_KEY` is already set, JJcoder will use it automatically.</p>
                <label className="field">
                  <span>OpenRouter API key</span>
                  <input
                    type="password"
                    value={openrouterKey}
                    onChange={(event) => setOpenrouterKey(event.target.value)}
                    placeholder={snapshot.auth.openRouterConfigured ? "Already connected" : "sk-or-v1-..."}
                  />
                </label>
                <div className="setup-actions">
                  <button type="button" className="primary-button" onClick={() => void saveTokens()}>
                    Save key
                  </button>
                  <button type="button" className="toolbar-chip" onClick={() => void refreshConnections()}>
                    Re-check
                  </button>
                </div>
              </section>

              <section className="setup-card">
                <div className="setup-card-header">
                  <div>
                    <p className="eyebrow">Publish</p>
                    <h3>GitHub</h3>
                  </div>
                  <span className={`status-pill ${snapshot.auth.githubConfigured ? "status-completed" : "status-queued"}`}>
                    {snapshot.auth.githubConfigured ? describeSource(snapshot.auth.githubSource) : "optional"}
                  </span>
                </div>
                <p>JJcoder can reuse an existing GitHub CLI login when `gh` is installed. Otherwise, the connect button opens the GitHub token page so the user can create a token and paste it here.</p>
                <div className="setup-meta">
                  <span>CLI installed: {snapshot.auth.githubCliInstalled ? "Yes" : "No"}</span>
                </div>
                <label className="field">
                  <span>GitHub token</span>
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(event) => setGithubToken(event.target.value)}
                    placeholder={snapshot.auth.githubConfigured ? "Already connected" : "Optional fallback token"}
                  />
                </label>
                <div className="setup-actions">
                  <button type="button" className="primary-button" onClick={() => void launchProviderLogin("github")}>
                    Open GitHub setup
                  </button>
                  <button type="button" className="toolbar-chip" onClick={() => void saveTokens()}>
                    Save token
                  </button>
                  <button type="button" className="toolbar-chip" onClick={() => void refreshConnections()}>
                    Re-check
                  </button>
                </div>
              </section>

              <section className="setup-card">
                <div className="setup-card-header">
                  <div>
                    <p className="eyebrow">Deploy</p>
                    <h3>Vercel</h3>
                  </div>
                  <span className={`status-pill ${snapshot.auth.vercelConfigured ? "status-completed" : "status-queued"}`}>
                    {snapshot.auth.vercelConfigured ? describeSource(snapshot.auth.vercelSource) : "optional"}
                  </span>
                </div>
                <p>Use a stored token, `VERCEL_TOKEN`, or an existing Vercel CLI login. If a system CLI is not installed, JJcoder can fall back to its bundled Vercel tooling or open the token page.</p>
                <div className="setup-meta">
                  <span>CLI available: {snapshot.auth.vercelCliInstalled ? "Yes" : "No, token flow available"}</span>
                </div>
                <label className="field">
                  <span>Vercel token</span>
                  <input
                    type="password"
                    value={vercelToken}
                    onChange={(event) => setVercelToken(event.target.value)}
                    placeholder={snapshot.auth.vercelConfigured ? "Already connected" : "Optional fallback token"}
                  />
                </label>
                <div className="setup-actions">
                  <button type="button" className="primary-button" onClick={() => void launchProviderLogin("vercel")}>
                    Open Vercel setup
                  </button>
                  <button type="button" className="toolbar-chip" onClick={() => void saveTokens()}>
                    Save token
                  </button>
                  <button type="button" className="toolbar-chip" onClick={() => void refreshConnections(true)}>
                    Re-check
                  </button>
                </div>
              </section>

              <section className="setup-card">
                <div className="setup-card-header">
                  <div>
                    <p className="eyebrow">Workspace</p>
                    <h3>Default folder</h3>
                  </div>
                  <span className={`status-pill ${snapshot.settings.websitesRoot ? "status-completed" : "status-queued"}`}>
                    {snapshot.settings.websitesRoot ? "ready" : "choose folder"}
                  </span>
                </div>
                <p>New websites can default into one root directory so first-time users are not guessing where files will be created.</p>
                <label className="field">
                  <span>Workspace root</span>
                  <div className="inline-row">
                    <input
                      value={snapshot.settings.websitesRoot ?? ""}
                      onChange={(event) =>
                        setSnapshot((prev) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            websitesRoot: event.target.value
                          }
                        }))
                      }
                      placeholder="C:\\Sites"
                    />
                    <button
                      type="button"
                      className="toolbar-chip"
                      onClick={() =>
                        void window.jjcoder
                          .pickFolder()
                          .then((value) => {
                            if (!value) {
                              return;
                            }
                            setSnapshot((prev) => ({
                              ...prev,
                              settings: {
                                ...prev.settings,
                                websitesRoot: value
                              }
                            }));
                          })
                          .catch(handleError)
                      }
                    >
                      Browse
                    </button>
                  </div>
                </label>
                <div className="setup-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      void mutateSnapshot(async () =>
                        await window.jjcoder.updateSettings({
                          websitesRoot: snapshot.settings.websitesRoot,
                          onboardingCompletedAt: snapshot.settings.onboardingCompletedAt
                        })
                      )
                    }
                  >
                    Save folder
                  </button>
                  <button
                    type="button"
                    className="toolbar-chip"
                    onClick={() => {
                      setShowCreateWebsite(true);
                      setShowOnboarding(false);
                    }}
                  >
                    Create first website
                  </button>
                </div>
              </section>
            </div>

            <footer className="dialog-actions">
              <button type="button" className="toolbar-chip" onClick={() => setShowSettings(true)}>
                Advanced settings
              </button>
              <button type="button" className="primary-button" onClick={() => void completeOnboarding()}>
                Finish setup
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {showCreateWebsite ? (
        <div className="overlay">
          <div className="dialog">
            <header>
              <p className="eyebrow">New workspace</p>
              <h2>Create website</h2>
            </header>
            <label className="field">
              <span>Name</span>
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="My Website" />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Landing page for..."
              />
            </label>
            <label className="field">
              <span>Folder</span>
              <div className="inline-row">
                <input
                  value={createPath}
                  onChange={(event) => {
                    setCreatePathTouched(true);
                    setCreatePath(event.target.value);
                  }}
                  placeholder={snapshot.settings.websitesRoot ? joinPath(snapshot.settings.websitesRoot, "my-website") : "C:\\Sites\\my-website"}
                />
                <button
                  type="button"
                  className="toolbar-chip"
                  onClick={() =>
                    void window.jjcoder
                      .pickFolder()
                      .then((value) => {
                        if (value) {
                          setCreatePathTouched(true);
                          setCreatePath(value);
                        }
                      })
                      .catch(handleError)
                  }
                >
                  Browse
                </button>
              </div>
            </label>
            <footer className="dialog-actions">
              <button type="button" className="toolbar-chip" onClick={() => setShowCreateWebsite(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => void createWebsite()}>
                Create
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {renameDialog ? (
        <div className="overlay">
          <div className="dialog">
            <header>
              <p className="eyebrow">{renameDialog.kind === "website" ? "Project" : "Thread"}</p>
              <h2>Rename {renameDialog.kind === "website" ? "project" : "thread"}</h2>
            </header>
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={renameDialog.value}
                onChange={(event) =>
                  setRenameDialog((current) => (current ? { ...current, value: event.target.value } : current))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
              />
            </label>
            <footer className="dialog-actions">
              <button type="button" className="toolbar-chip" onClick={() => setRenameDialog(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => void submitRename()}>
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className="overlay">
          <div className="dialog">
            <header>
              <p className="eyebrow">{deleteDialog.kind === "website" ? "Project" : "Thread"}</p>
              <h2>{deleteDialog.kind === "website" ? "Remove project" : "Delete thread"}</h2>
            </header>
            <p>
              {deleteDialog.kind === "website"
                ? `Remove "${deleteDialog.name}" from JJcoder. The workspace folder stays on disk.`
                : `Delete "${deleteDialog.name}" and remove its run history from JJcoder.`}
            </p>
            <footer className="dialog-actions">
              <button type="button" className="toolbar-chip" onClick={() => setDeleteDialog(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => void confirmDelete()}>
                {deleteDialog.kind === "website" ? "Remove" : "Delete"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="overlay">
          <div className="dialog dialog-wide">
            <header>
              <p className="eyebrow">Configuration</p>
              <h2>Settings</h2>
            </header>
            <div className="settings-grid">
              <label className="field">
                <span>OpenRouter API key</span>
                <input
                  type="password"
                  value={openrouterKey}
                  onChange={(event) => setOpenrouterKey(event.target.value)}
                  placeholder={snapshot.auth.openRouterConfigured ? "Stored or auto-detected" : "sk-or-v1-..."}
                />
                <small className="field-note">{describeSource(snapshot.auth.openRouterSource)}</small>
              </label>
              <label className="field">
                <span>GitHub token</span>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.target.value)}
                  placeholder={snapshot.auth.githubConfigured ? "Stored or auto-detected" : "ghp_..."}
                />
                <small className="field-note">{describeSource(snapshot.auth.githubSource)}</small>
              </label>
              <label className="field">
                <span>Vercel token</span>
                <input
                  type="password"
                  value={vercelToken}
                  onChange={(event) => setVercelToken(event.target.value)}
                  placeholder={snapshot.auth.vercelConfigured ? "Stored or auto-detected" : "vercel_..."}
                />
                <small className="field-note">{describeSource(snapshot.auth.vercelSource)}</small>
              </label>
              <label className="field">
                <span>IDE command</span>
                <input
                  value={snapshot.settings.ideCommand}
                  onChange={(event) =>
                    setSnapshot((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        ideCommand: event.target.value
                      }
                    }))
                  }
                  placeholder="code"
                />
              </label>
              <label className="field">
                <span>Workspace root</span>
                <input
                  value={snapshot.settings.websitesRoot ?? ""}
                  onChange={(event) =>
                    setSnapshot((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        websitesRoot: event.target.value
                      }
                    }))
                  }
                  placeholder="C:\\Sites"
                />
              </label>
              <label className="field">
                <span>Vercel Team ID</span>
                <input
                  value={snapshot.settings.vercelTeamId}
                  onChange={(event) =>
                    setSnapshot((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        vercelTeamId: event.target.value
                      }
                    }))
                  }
                  placeholder="team_xxx"
                />
              </label>
              <label className="field">
                <span>Vercel Team slug</span>
                <input
                  value={snapshot.settings.vercelTeamSlug}
                  onChange={(event) =>
                    setSnapshot((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        vercelTeamSlug: event.target.value
                      }
                    }))
                  }
                  placeholder="my-team"
                />
              </label>
            </div>
            <div className="settings-actions">
              <button type="button" className="toolbar-chip" onClick={() => void launchProviderLogin("github")}>
                <SparklesIcon size={13} />
                GitHub setup
              </button>
              <button type="button" className="toolbar-chip" onClick={() => void launchProviderLogin("vercel")}>
                <SparklesIcon size={13} />
                Vercel setup
              </button>
              <button type="button" className="toolbar-chip" onClick={() => void refreshConnections(true)}>
                Refresh connections
              </button>
            </div>
            <div className="settings-note">
              <p>Encryption: {snapshot.auth.encryptionAvailable ? "Available" : "Unavailable"}</p>
              <small>Secrets stay local. JJcoder reuses existing CLI logins when available, otherwise users can create tokens in the browser and save them here.</small>
            </div>
            <footer className="dialog-actions">
              <button type="button" className="toolbar-chip" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => void saveTokens()}>
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {loading ? <div className="loading-screen">Loading...</div> : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
