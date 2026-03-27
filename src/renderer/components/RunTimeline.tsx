import { BotIcon, HammerIcon, AlertTriangleIcon, SparklesIcon } from "lucide-react";
import type { AgentRun, RunEvent } from "@shared/types";
import { formatDateTime } from "@renderer/lib/format";

function iconForEvent(event: RunEvent) {
  switch (event.type) {
    case "tool":
      return <HammerIcon size={13} />;
    case "error":
      return <AlertTriangleIcon size={13} />;
    case "assistant":
      return <BotIcon size={13} />;
    default:
      return <SparklesIcon size={13} />;
  }
}

export function RunTimeline({ run }: { run: AgentRun | null }) {
  if (!run) {
    return (
      <div className="empty-panel">
        <p className="eyebrow">Timeline</p>
        <h2>No run selected</h2>
        <p>Select a run from the sidebar to see agent activity.</p>
      </div>
    );
  }

  return (
    <div className="timeline-area">
      <div className="timeline-header">
        <h3>{run.title}</h3>
        <span className={`status-pill status-${run.status}`}>{run.status}</span>
      </div>

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
          <article key={event.id} className={`timeline-event timeline-${event.type}`}>
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
