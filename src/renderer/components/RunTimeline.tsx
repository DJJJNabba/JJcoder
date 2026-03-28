import { AlertTriangleIcon, BotIcon, HammerIcon, SparklesIcon } from "lucide-react";
import type { AgentRun } from "@shared/types";
import { formatDateTime, statusLabel } from "@renderer/lib/format";
import { deriveTimelineActivities, type TimelineActivity } from "@renderer/lib/runTimeline";

function iconForActivity(activity: TimelineActivity) {
  switch (activity.kind) {
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

function pillClassName(activity: TimelineActivity): string {
  switch (activity.kind) {
    case "tool":
      return activity.resolved ? "status-completed" : "status-queued";
    case "error":
      return "status-failed";
    default:
      return "status-idle";
  }
}

function pillLabel(activity: TimelineActivity): string {
  switch (activity.kind) {
    case "tool":
      return activity.resolved ? "done" : "tool";
    case "error":
      return "error";
    default:
      return activity.tag ?? "info";
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

  const activities = deriveTimelineActivities(run.events);

  return (
    <div className="timeline-area">
      <div className="timeline-header">
        <h3>{run.title}</h3>
        <span className={`status-pill status-${run.status}`}>{statusLabel(run.status)}</span>
      </div>

      <div className="run-summary-block">
        <h3>Prompt</h3>
        <p>{run.prompt}</p>
        <div className="run-summary-meta">
          <span>{run.modelId}</span>
          <span>{run.interactionMode}</span>
          <span>{formatDateTime(run.updatedAt)}</span>
        </div>
      </div>

      <div className="timeline-list">
        {activities.map((activity) => (
          <article key={activity.id} className={`timeline-entry timeline-${activity.tone}`}>
            <div className="timeline-entry-icon">{iconForActivity(activity)}</div>
            <div className="timeline-entry-copy">
              <div className="timeline-entry-topline">
                <strong>{activity.title}</strong>
                <span className={`status-pill ${pillClassName(activity)}`}>{pillLabel(activity)}</span>
              </div>

              <div className="timeline-entry-meta">
                <span>{activity.agent}</span>
                <span>{formatDateTime(activity.createdAt)}</span>
                {activity.toolName ? <span>{activity.toolName}</span> : null}
              </div>

              {activity.note ? <p className="timeline-entry-note">{activity.note}</p> : null}
              {activity.body ? <pre className="timeline-entry-body">{activity.body}</pre> : null}

              {activity.rawInput || activity.rawOutput ? (
                <details className="timeline-disclosure">
                  <summary>Raw data</summary>
                  {activity.rawInput ? (
                    <div className="timeline-disclosure-block">
                      <span>Input</span>
                      <pre>{activity.rawInput}</pre>
                    </div>
                  ) : null}
                  {activity.rawOutput ? (
                    <div className="timeline-disclosure-block">
                      <span>Output</span>
                      <pre>{activity.rawOutput}</pre>
                    </div>
                  ) : null}
                </details>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
