import { useEffect, useRef } from "react";
import { CheckIcon, AlertTriangleIcon, LoaderIcon, ChevronRightIcon } from "lucide-react";
import type { AgentRun } from "@shared/types";
import { formatRelativeTime, statusLabel } from "@renderer/lib/format";
import { deriveTimelineActivities, type TimelineActivity } from "@renderer/lib/runTimeline";

/* ── helpers ── */

function isToolActivity(a: TimelineActivity): boolean {
  return a.kind === "tool";
}

function isFinalNote(a: TimelineActivity): boolean {
  return a.kind === "assistant" && a.agent === "builder" && (a.tag === "note" || a.tag === "output");
}

function toolStatusIcon(a: TimelineActivity) {
  if (!a.resolved) return <LoaderIcon size={11} className="chat-spin" />;
  return <CheckIcon size={11} />;
}

/* ── Single run rendered as a chat turn ── */

function RunMessages({ run }: { run: AgentRun }) {
  const activities = deriveTimelineActivities(run.events);

  // Separate tool activities (collapsed) from meaningful messages
  const tools = activities.filter(isToolActivity);
  const finalNote = activities.find(isFinalNote);
  const errors = activities.filter((a) => a.kind === "error");

  return (
    <>
      {/* User message bubble */}
      <div className="chat-row chat-row-user">
        <div className="chat-bubble-user">
          <p>{run.prompt}</p>
        </div>
      </div>

      {/* Agent response area */}
      <div className="chat-row chat-row-agent">
        <div className="chat-agent-block">
          {/* Status header */}
          <div className="chat-agent-header">
            <span className={`chat-status-dot chat-status-${run.status}`} />
            <span className="chat-agent-label">{statusLabel(run.status)}</span>
            <span className="chat-meta">{run.modelId.split("/").pop()}</span>
            <span className="chat-meta">{run.mode}</span>
            <span className="chat-meta">{formatRelativeTime(run.updatedAt)}</span>
          </div>

          {/* Collapsed tool calls */}
          {tools.length > 0 ? (
            <details className="chat-tools-group">
              <summary>
                <ChevronRightIcon size={12} className="chat-tools-chevron" />
                <span>{tools.length} action{tools.length === 1 ? "" : "s"}</span>
                {tools.every((t) => t.resolved) ? (
                  <CheckIcon size={12} className="chat-tools-done" />
                ) : (
                  <LoaderIcon size={12} className="chat-spin" />
                )}
              </summary>
              <div className="chat-tools-list">
                {tools.map((tool) => (
                  <div key={tool.id} className="chat-tool-row">
                    <span className="chat-tool-icon">{toolStatusIcon(tool)}</span>
                    <span className="chat-tool-name">{tool.title}</span>
                    {tool.note ? <span className="chat-tool-note">{tool.note}</span> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {/* Errors */}
          {errors.map((err) => (
            <div key={err.id} className="chat-error">
              <AlertTriangleIcon size={13} />
              <span>{err.title}</span>
              {err.body ? <pre>{err.body}</pre> : null}
            </div>
          ))}

          {/* Final agent message */}
          {finalNote?.body ? (
            <div className="chat-agent-message">
              <p>{finalNote.body}</p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ── Full chat thread for a website ── */

interface ChatThreadProps {
  runs: AgentRun[];
}

export function ChatThread({ runs }: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom when new content arrives
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runs]);

  if (runs.length === 0) {
    return (
      <div className="chat-empty">
        <p>No messages yet.</p>
        <p className="chat-empty-sub">Type a prompt below to start building.</p>
      </div>
    );
  }

  // Show runs oldest-first so the chat reads top-to-bottom
  const sorted = [...runs].reverse();

  return (
    <div className="chat-scroll">
      {sorted.map((run) => (
        <RunMessages key={run.id} run={run} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
