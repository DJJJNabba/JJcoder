import { BotIcon, HammerIcon, AlertTriangleIcon, SparklesIcon } from "lucide-react";
import type { AgentRun, RunEvent } from "@shared/types";
import { formatDateTime } from "@renderer/lib/format";

function iconForEvent(event: RunEvent) {
  switch (event.type) {
    case "tool":
      return <HammerIcon size={14} />;
    case "error":
      return <AlertTriangleIcon size={14} />;
    case "assistant":
      return <BotIcon size={14} />;
    default:
      return <SparklesIcon size={14} />;
  }
}

export function RunTimeline({ run }: { run: AgentRun | null }) {
  if (!run) {
    return (
      <div className="empty-panel">
        <p className="eyebrow">Run activity</p>
        <h2>Select a website run</h2>
        <p>Agent messages, tool calls, and verification notes will appear here.</p>
      </div>
    );
  }

  return (
    <div className="timeline-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Run timeline</p>
          <h2>{run.title}</h2>
        </div>
        <div className={`status-pill status-${run.status}`}>{run.status}</div>
      </header>

      <div className="run-summary-block">
        <h3>Prompt</h3>
        <p>{run.prompt}</p>
        <div className="run-summary-meta">
          <span>{run.modelId}</span>
          <span>{run.mode}</span>
          <span>{formatDateTime(run.updatedAt)}</span>
        </div>
      </div>

      <div className="timeline-list">
        {run.events.map((event) => (
          <article key={event.id} className={`timeline-card timeline-${event.type}`}>
            <div className="timeline-icon">{iconForEvent(event)}</div>
            <div className="timeline-copy">
              <header>
                <strong>{event.title}</strong>
                <span>{event.agent}</span>
              </header>
              <pre>{event.content}</pre>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
