import { useEffect, useMemo, useState } from "react";
import {
  BotIcon,
  GitForkIcon,
  LayoutTemplateIcon,
  PlayIcon,
  RocketIcon,
  Settings2Icon,
  WandSparklesIcon
} from "lucide-react";
import type { AppSnapshot } from "@shared/types";
import { ModelPicker } from "./components/ModelPicker";
import { PreviewPane } from "./components/PreviewPane";
import { RunTimeline } from "./components/RunTimeline";
import { WebsiteSidebar } from "./components/WebsiteSidebar";
import { formatDateTime } from "./lib/format";

const EMPTY_SNAPSHOT: AppSnapshot = {
  productName: "JJcoder",
  productVersion: "0.1.0",
  auth: {
    openRouterConfigured: false,
    githubConfigured: false,
    vercelConfigured: false,
    encryptionAvailable: false
  },
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
  models: [],
  modelsFetchedAt: null,
  websites: [],
  runs: []
};

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWebsite, setShowCreateWebsite] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [repoName, setRepoName] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [vercelToken, setVercelToken] = useState("");

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
        vercelTeamSlug: snapshot.settings.vercelTeamSlug
      });
      setOpenrouterKey("");
      setGithubToken("");
      setVercelToken("");
      return next;
    });
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
    await mutateSnapshot(async () => {
      const next = await window.jjcoder.createWebsite({
        name: createName,
        description: createDescription,
        workspacePath: createPath,
        scaffold: true
      });
      setShowCreateWebsite(false);
      setCreateName("");
      setCreateDescription("");
      setCreatePath("");
      return next;
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

  return (
    <div className="app-shell">
      <WebsiteSidebar
        websites={snapshot.websites}
        runs={snapshot.runs}
        selectedWebsiteId={snapshot.settings.selectedWebsiteId}
        selectedRunId={snapshot.settings.selectedRunId}
        onSelectWebsite={(websiteId) => void selectWebsite(websiteId)}
        onSelectRun={(runId, websiteId) => void selectRun(runId, websiteId)}
        onCreateWebsite={() => setShowCreateWebsite(true)}
      />

      <main className="workspace-shell">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Agentic React builder</p>
            <h2>{activeWebsite?.name ?? "Spin up your first website"}</h2>
            <span className="header-caption">
              {activeWebsite
                ? `${activeWebsite.workspacePath} • updated ${formatDateTime(activeWebsite.updatedAt)}`
                : "OpenRouter-powered website generation with GitHub and Vercel baked in."}
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
            <button type="button" className="icon-button" onClick={() => setShowSettings(true)} title="Settings">
              <Settings2Icon size={16} />
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="stats-grid">
          <article className="stat-card">
            <span>Catalog</span>
            <strong>{snapshot.models.length}</strong>
            <small>OpenRouter models cached</small>
          </article>
          <article className="stat-card">
            <span>Auth</span>
            <strong>{snapshot.auth.openRouterConfigured ? "Ready" : "Missing"}</strong>
            <small>OpenRouter key status</small>
          </article>
          <article className="stat-card">
            <span>GitHub</span>
            <strong>{activeWebsite?.github.repoUrl ? "Published" : "Local"}</strong>
            <small>{activeWebsite?.github.repoUrl ?? "Create a repo from the toolbar"}</small>
          </article>
          <article className="stat-card">
            <span>Deploy</span>
            <strong>{activeWebsite?.vercel.deploymentUrl ? "Live" : "Pending"}</strong>
            <small>{activeWebsite?.vercel.deploymentUrl ?? "Deploy to Vercel when ready"}</small>
          </article>
        </section>

        <section className="workspace-toolbar">
          <button
            type="button"
            className="toolbar-chip"
            disabled={!activeWebsite}
            onClick={() => activeWebsite && void window.jjcoder.openInIde(activeWebsite.id).catch(handleError)}
          >
            <LayoutTemplateIcon size={14} />
            Open in IDE
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
            <GitForkIcon size={14} />
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
            <GitForkIcon size={14} />
            Publish GitHub
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
            <GitForkIcon size={14} />
            Open GitHub
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
            <RocketIcon size={14} />
            Deploy to Vercel
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
            <PlayIcon size={14} />
            Start preview
          </button>
          <label className="inline-field">
            <span>Repo name</span>
            <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="jjcoder-site" />
          </label>
        </section>

        <section className="workbench-grid">
          <div className="left-column">
            <div className="composer-card">
              <header className="panel-header">
                <div>
                  <p className="eyebrow">Dispatch agent</p>
                  <h2>Build prompt</h2>
                </div>
                <div className="status-pill status-running">
                  <BotIcon size={14} />
                  {snapshot.settings.agentMode}
                </div>
              </header>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Build a bold SaaS landing page for a robotics platform, with pricing, testimonials, and a waitlist CTA..."
              />
              <div className="composer-footer">
                <span>
                  {snapshot.auth.openRouterConfigured
                    ? "OpenRouter is ready."
                    : "Add your OpenRouter key in Settings to dispatch agents."}
                </span>
                <button type="button" className="primary-button" disabled={!activeWebsite || !prompt.trim()} onClick={() => void dispatchRun()}>
                  <WandSparklesIcon size={14} />
                  Dispatch build
                </button>
              </div>
            </div>

            <RunTimeline run={selectedRun} />
          </div>

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

      {showCreateWebsite ? (
        <div className="overlay">
          <div className="dialog-card">
            <header>
              <p className="eyebrow">Create website</p>
              <h2>Scaffold a new React workspace</h2>
            </header>
            <label className="field">
              <span>Name</span>
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Nova Robotics" />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Landing page for the robotics launch"
              />
            </label>
            <label className="field">
              <span>Folder</span>
              <div className="inline-row">
                <input value={createPath} onChange={(event) => setCreatePath(event.target.value)} placeholder="C:\\Sites\\nova-robotics" />
                <button
                  type="button"
                  className="toolbar-chip"
                  onClick={() =>
                    void window.jjcoder
                      .pickFolder()
                      .then((value) => {
                        if (value) {
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
              <button type="button" className="primary-button" disabled={!createPath.trim()} onClick={() => void createWebsite()}>
                Create workspace
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="overlay">
          <div className="dialog-card settings-card">
            <header>
              <p className="eyebrow">Settings</p>
              <h2>Credentials and defaults</h2>
            </header>
            <div className="settings-grid">
              <label className="field">
                <span>OpenRouter API key</span>
                <input
                  type="password"
                  value={openrouterKey}
                  onChange={(event) => setOpenrouterKey(event.target.value)}
                  placeholder={snapshot.auth.openRouterConfigured ? "Stored securely" : "sk-or-v1-..."}
                />
              </label>
              <label className="field">
                <span>GitHub token</span>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.target.value)}
                  placeholder={snapshot.auth.githubConfigured ? "Stored securely" : "ghp_..."}
                />
              </label>
              <label className="field">
                <span>Vercel token</span>
                <input
                  type="password"
                  value={vercelToken}
                  onChange={(event) => setVercelToken(event.target.value)}
                  placeholder={snapshot.auth.vercelConfigured ? "Stored securely" : "vercel_..."}
                />
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
            <div className="settings-note">
              <p>Encryption available: {snapshot.auth.encryptionAvailable ? "Yes" : "No"}</p>
              <small>JJcoder stores secrets locally and uses Electron safe storage whenever the OS supports it.</small>
            </div>
            <footer className="dialog-actions">
              <button type="button" className="toolbar-chip" onClick={() => setShowSettings(false)}>
                Close
              </button>
              <button type="button" className="primary-button" onClick={() => void saveTokens()}>
                Save settings
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {loading ? <div className="loading-screen">Loading JJcoder…</div> : null}
    </div>
  );
}
