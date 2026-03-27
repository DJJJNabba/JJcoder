import { PlusIcon, FolderCodeIcon, RocketIcon, GitForkIcon, EyeIcon } from "lucide-react";
import type { AgentRun, Website } from "@shared/types";
import { formatRelativeTime, statusLabel } from "@renderer/lib/format";

interface WebsiteSidebarProps {
  websites: Website[];
  runs: AgentRun[];
  selectedWebsiteId: string | null;
  selectedRunId: string | null;
  onSelectWebsite: (websiteId: string) => void;
  onSelectRun: (runId: string, websiteId: string) => void;
  onCreateWebsite: () => void;
}

export function WebsiteSidebar(props: WebsiteSidebarProps) {
  return (
    <aside className="website-sidebar">
      <div className="sidebar-brand">
        <div>
          <p className="eyebrow">JJcoder</p>
          <h1>Projects</h1>
        </div>
        <button type="button" className="icon-button" onClick={props.onCreateWebsite} title="New website">
          <PlusIcon size={14} />
        </button>
      </div>

      <div className="sidebar-scroll">
        {props.websites.length === 0 ? (
          <div className="empty-sidebar">
            <FolderCodeIcon size={16} />
            <p>No websites yet</p>
            <button type="button" className="text-button" onClick={props.onCreateWebsite}>
              Create your first workspace
            </button>
          </div>
        ) : null}

        {props.websites.map((website) => {
          const websiteRuns = props.runs.filter((run) => run.websiteId === website.id);
          const selected = website.id === props.selectedWebsiteId;
          return (
            <section key={website.id} className={`website-group ${selected ? "selected" : ""}`}>
              <button type="button" className="website-row" onClick={() => props.onSelectWebsite(website.id)}>
                <div className="website-copy">
                  <strong>{website.name}</strong>
                  <span>{website.description}</span>
                </div>
                <div className="website-meta">
                  {website.preview.url ? <EyeIcon size={12} /> : null}
                  {website.github.repoUrl ? <GitForkIcon size={12} /> : null}
                  {website.vercel.deploymentUrl ? <RocketIcon size={12} /> : null}
                </div>
              </button>
              <p className="website-path">{website.workspacePath}</p>
              <div className="website-runs">
                {websiteRuns.length === 0 ? <span className="run-placeholder">No runs</span> : null}
                {websiteRuns.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    className={`run-row ${run.id === props.selectedRunId ? "selected" : ""}`}
                    onClick={() => props.onSelectRun(run.id, website.id)}
                  >
                    <div>
                      <strong>{run.title}</strong>
                      <span>{formatRelativeTime(run.updatedAt)}</span>
                    </div>
                    <span className={`status-pill status-${run.status}`}>{statusLabel(run.status)}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
