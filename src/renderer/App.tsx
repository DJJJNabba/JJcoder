import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  GitForkIcon,
  LayoutTemplateIcon,
  PlayIcon,
  RocketIcon,
  Settings2Icon,
  SendIcon,
  SparklesIcon,
  WandSparklesIcon
} from "lucide-react";
import type { AppSnapshot, AuthSource, ProviderLoginKind } from "@shared/types";
import { ModelPicker } from "./components/ModelPicker";
import { PreviewPane } from "./components/PreviewPane";
import { RunTimeline } from "./components/RunTimeline";
import { WebsiteSidebar } from "./components/WebsiteSidebar";

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
    selectedRunId: null,
    preferredModelId: "openrouter/auto",
    agentMode: "squad",
    ideCommand: "code",
    websitesRoot: null,
    vercelTeamId: "",
    vercelTeamSlug: "",
    onboardingCompletedAt: null
  },
  models: [],
  modelsFetchedAt: null,
  websites: [],
  runs: []
};

const SIDEBAR_WIDTH_KEY = "jjcoder.sidebar.width";
const WORKBENCH_WIDTH_KEY = "jjcoder.workbench.left.width";
const DEFAULT_SIDEBAR_WIDTH = 280;
const DEFAULT_WORKBENCH_LEFT_WIDTH = 520;
const MIN_SIDEBAR_WIDTH = 220;
const MIN_WORKBENCH_LEFT_WIDTH = 360;
const MIN_PREVIEW_WIDTH = 320;
const MIN_WORKSPACE_WIDTH = 720;

function readStoredNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function writeStoredNumber(key: string, value: number) {
  window.localStorage.setItem(key, String(Math.round(value)));
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

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWebsite, setShowCreateWebsite] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [createPathTouched, setCreatePathTouched] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [vercelToken, setVercelToken] = useState("");
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
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    void window.jjcoder
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

    const unsubscribeSnapshot = window.jjcoder.subscribe("snapshot", (next) => {
      setSnapshot(next);
    });
    const unsubscribeRun = window.jjcoder.subscribe("run-updated", (run) => {
      setSnapshot((prev) => ({
        ...prev,
        runs: [run, ...prev.runs.filter((candidate) => candidate.id !== run.id)]
      }));
    });
    const unsubscribePreview = window.jjcoder.subscribe("preview-updated", ({ websiteId, preview }) => {
      setSnapshot((prev) => ({
        ...prev,
        websites: prev.websites.map((website) => (website.id === websiteId ? { ...website, preview } : website))
      }));
    });

    return () => {
      disposed = true;
      unsubscribeSnapshot();
      unsubscribeRun();
      unsubscribePreview();
    };
  }, []);

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
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) {
        return;
      }

      if (resizeRef.current.target === "sidebar") {
        const totalWidth = appShellRef.current?.clientWidth ?? 0;
        const nextWidth = clamp(
          resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX),
          MIN_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, totalWidth - MIN_WORKSPACE_WIDTH)
        );
        setSidebarWidth(nextWidth);
        return;
      }

      const totalWidth = workbenchRef.current?.clientWidth ?? 0;
      const nextWidth = clamp(
        resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX),
        MIN_WORKBENCH_LEFT_WIDTH,
        Math.max(MIN_WORKBENCH_LEFT_WIDTH, totalWidth - MIN_PREVIEW_WIDTH)
      );
      setWorkbenchLeftWidth(nextWidth);
    };

    const handlePointerUp = () => {
      if (!resizeRef.current) {
        return;
      }

      writeStoredNumber(SIDEBAR_WIDTH_KEY, sidebarWidth);
      writeStoredNumber(WORKBENCH_WIDTH_KEY, workbenchLeftWidth);
      resizeRef.current = null;
      document.body.classList.remove("is-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [sidebarWidth, workbenchLeftWidth]);

  const selectedWebsite = useMemo(() => {
    return snapshot.websites.find((website) => website.id === snapshot.settings.selectedWebsiteId) ?? null;
  }, [snapshot.settings.selectedWebsiteId, snapshot.websites]);

  const selectedRun = useMemo(() => {
    return snapshot.runs.find((run) => run.id === snapshot.settings.selectedRunId) ?? null;
  }, [snapshot.runs, snapshot.settings.selectedRunId]);

  const activeWebsite = selectedWebsite ?? snapshot.websites[0] ?? null;

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
      const nextRun = snapshot.runs.find((run) => run.websiteId === websiteId)?.id ?? null;
      return await window.jjcoder.updateSettings({
        selectedWebsiteId: websiteId,
        selectedRunId: nextRun
      });
    });
  };

  const selectRun = async (runId: string, websiteId: string) => {
    await mutateSnapshot(async () => {
      return await window.jjcoder.updateSettings({
        selectedWebsiteId: websiteId,
        selectedRunId: runId
      });
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
    if (!activeWebsite || !prompt.trim()) {
      return;
    }
    await mutateSnapshot(async () => {
      const next = await window.jjcoder.dispatchRun({
        websiteId: activeWebsite.id,
        prompt: prompt.trim()
      });
      setPrompt("");
      return next;
    });
  };

  const beginResize = (target: ResizeTarget) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = {
      target,
      startX: event.clientX,
      startWidth: target === "sidebar" ? sidebarWidth : workbenchLeftWidth
    };
    document.body.classList.add("is-resizing");
  };

  return (
    <div
      ref={appShellRef}
      className="app-shell"
      style={{ gridTemplateColumns: `${sidebarWidth}px var(--divider-size) minmax(0, 1fr)` }}
    >
      <WebsiteSidebar
        websites={snapshot.websites}
        runs={snapshot.runs}
        selectedWebsiteId={snapshot.settings.selectedWebsiteId}
        selectedRunId={snapshot.settings.selectedRunId}
        onSelectWebsite={(websiteId) => void selectWebsite(websiteId)}
        onSelectRun={(runId, websiteId) => void selectRun(runId, websiteId)}
        onCreateWebsite={() => setShowCreateWebsite(true)}
      />

      <div
        className="panel-divider"
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
                className={snapshot.settings.agentMode === "solo" ? "active" : ""}
                onClick={() => {
                  void mutateSnapshot(async () => await window.jjcoder.updateSettings({ agentMode: "solo" }));
                }}
              >
                Solo
              </button>
              <button
                type="button"
                className={snapshot.settings.agentMode === "squad" ? "active" : ""}
                onClick={() => {
                  void mutateSnapshot(async () => await window.jjcoder.updateSettings({ agentMode: "squad" }));
                }}
              >
                Squad
              </button>
            </div>
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
                .startPreview(activeWebsite.id)
                .then(setSnapshot)
                .catch(handleError)
            }
          >
            <PlayIcon size={13} />
            Preview
          </button>
          <label className="inline-field">
            <span>Repo</span>
            <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="repo-name" />
          </label>
        </section>

        <section
          ref={workbenchRef}
          className="workbench-grid"
          style={{ gridTemplateColumns: `${workbenchLeftWidth}px var(--divider-size) minmax(${MIN_PREVIEW_WIDTH}px, 1fr)` }}
        >
          <div className="left-column">
            <div className="composer-area">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe what to build..."
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    void dispatchRun();
                  }
                }}
              />
              <div className="composer-footer">
                <span>
                  {snapshot.settings.agentMode} mode
                  {snapshot.auth.openRouterConfigured ? "" : " · Add OpenRouter in setup"}
                </span>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!activeWebsite || !prompt.trim()}
                  onClick={() => void dispatchRun()}
                >
                  <SendIcon size={13} />
                  Run
                </button>
              </div>
            </div>

            <RunTimeline run={selectedRun} />
          </div>

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
                <p>JJcoder can publish without a pasted token when GitHub CLI is already logged in. If not, launch the browser login once and come back here.</p>
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
                    Connect GitHub
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
                <p>Use a stored token, `VERCEL_TOKEN`, or a Vercel CLI login. The connect button opens a terminal and starts the browser-based login flow automatically.</p>
                <div className="setup-meta">
                  <span>CLI installed: {snapshot.auth.vercelCliInstalled ? "Yes" : "No, login can use npx"}</span>
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
                    Connect Vercel
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
                GitHub browser login
              </button>
              <button type="button" className="toolbar-chip" onClick={() => void launchProviderLogin("vercel")}>
                <SparklesIcon size={13} />
                Vercel browser login
              </button>
              <button type="button" className="toolbar-chip" onClick={() => void refreshConnections(true)}>
                Refresh connections
              </button>
            </div>
            <div className="settings-note">
              <p>Encryption: {snapshot.auth.encryptionAvailable ? "Available" : "Unavailable"}</p>
              <small>Secrets stay local. When possible, JJcoder also reuses existing CLI logins and environment variables automatically.</small>
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
