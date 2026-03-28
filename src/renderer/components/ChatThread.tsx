import { Fragment, useEffect, useRef } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeIcon,
  FileEditIcon,
  FileIcon,
  FlagIcon,
  FolderOpenIcon,
  LoaderIcon,
  MessageSquareIcon,
  PlayIcon,
  TerminalIcon,
  TrashIcon
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentRun } from "@shared/types";
import { formatRelativeTime } from "@renderer/lib/format";
import { deriveTimelineActivities, type TimelineActivity } from "@renderer/lib/runTimeline";
import { ProposedPlanCard } from "./ProposedPlanCard";

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractFilePath(activity: TimelineActivity): string | undefined {
  const input = activity.rawInput ? parseJson(activity.rawInput) : null;
  const output = activity.rawOutput ? parseJson(activity.rawOutput) : null;
  const path = input?.path ?? output?.path;
  return typeof path === "string" ? path : undefined;
}

function extractCommand(activity: TimelineActivity): string | undefined {
  const input = activity.rawInput ? parseJson(activity.rawInput) : null;
  return typeof input?.command === "string" ? input.command : undefined;
}

function extractCommandOutput(activity: TimelineActivity): string | undefined {
  if (!activity.rawOutput) return undefined;
  const output = parseJson(activity.rawOutput);
  const stdout = typeof output?.stdout === "string" ? output.stdout.trim() : "";
  const stderr = typeof output?.stderr === "string" ? output.stderr.trim() : "";
  return (stderr || stdout).trim() || undefined;
}

function extractListFilesResult(activity: TimelineActivity): string | undefined {
  if (!activity.rawOutput) return undefined;
  const output = parseJson(activity.rawOutput);
  const files = Array.isArray(output?.files) ? output.files : null;
  const total = typeof output?.total === "number" ? output.total : null;
  if (total !== null) return `${total} file${total === 1 ? "" : "s"} found`;
  if (files) return `${files.length} file${files.length === 1 ? "" : "s"} found`;
  return undefined;
}

function toolIcon(activity: TimelineActivity) {
  switch (activity.toolName) {
    case "read_file":
      return <EyeIcon size={13} />;
    case "write_file":
      return <FileEditIcon size={13} />;
    case "delete_file":
      return <TrashIcon size={13} />;
    case "list_files":
      return <FolderOpenIcon size={13} />;
    case "run_workspace_command":
      return <TerminalIcon size={13} />;
    case "start_preview":
      return <PlayIcon size={13} />;
    case "finish_build":
      return <FlagIcon size={13} />;
    default:
      return <FileIcon size={13} />;
  }
}

function toolActionLabel(activity: TimelineActivity): string {
  switch (activity.toolName) {
    case "read_file":
      return "Read";
    case "write_file":
      return "Saved changes";
    case "delete_file":
      return "Deleted";
    case "list_files":
      return "Listed";
    case "run_workspace_command":
      return "Command";
    case "start_preview":
      return "Started preview";
    case "finish_build":
      return "Finished";
    case "request_user_input":
      return "Requested input";
    default:
      return "Tool";
  }
}

function statusIcon(activity: TimelineActivity) {
  if (!activity.resolved) return <LoaderIcon size={11} className="chat-spin" />;
  return <CheckIcon size={11} />;
}

function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}

function WorkingIndicator() {
  return (
    <div className="chat-working">
      <div className="chat-working-dots">
        <span />
        <span />
        <span />
      </div>
      <span>Thinking...</span>
    </div>
  );
}

function LiveToolRow({ activity }: { activity: TimelineActivity }) {
  const filePath = extractFilePath(activity);
  const command = extractCommand(activity);
  const displayTarget = filePath ?? command ?? activity.title;
  const actionLabel = toolActionLabel(activity);
  const detail = getToolDetail(activity);

  return (
    <div className={`chat-inline-tool ${activity.resolved ? "resolved" : "pending"}`}>
      <div className="chat-inline-tool-header">
        <span className="chat-live-status">{statusIcon(activity)}</span>
        <span className="chat-live-icon">{toolIcon(activity)}</span>
        <span className="chat-tool-action">{actionLabel}</span>
        <span className="chat-live-name" title={displayTarget}>{displayTarget}</span>
      </div>
      {detail ? <div className="chat-live-detail">{detail}</div> : null}
    </div>
  );
}

function getToolDetail(activity: TimelineActivity): string | null {
  if (!activity.resolved) return null;
  if (activity.toolName === "run_workspace_command") {
    return extractCommandOutput(activity) ?? "Command completed";
  }
  if (activity.toolName === "list_files") {
    return extractListFilesResult(activity) ?? null;
  }
  if (activity.toolName === "start_preview") {
    return "Preview server is running";
  }
  return activity.note ?? null;
}

function extractCompletionSummary(activity: TimelineActivity): string | null {
  const bodyJson = activity.body ? parseJson(activity.body) : null;
  if (typeof bodyJson?.summary === "string" && bodyJson.summary.trim()) {
    return bodyJson.summary.trim();
  }

  if (activity.body?.trim()) {
    return activity.body.trim();
  }

  const outputJson = activity.rawOutput ? parseJson(activity.rawOutput) : null;
  if (typeof outputJson?.summary === "string" && outputJson.summary.trim()) {
    return outputJson.summary.trim();
  }

  if (activity.note?.trim()) {
    return activity.note.trim();
  }

  return null;
}

function CompletionNotice({ activity }: { activity: TimelineActivity }) {
  const summary = extractCompletionSummary(activity);

  return (
    <div className="chat-completion" role="status" aria-live="polite">
      <div className="chat-completion-header">
        <span className="chat-completion-badge">
          <CheckIcon size={12} />
          Complete
        </span>
        <strong>{activity.title}</strong>
      </div>
      {summary ? <div className="chat-completion-copy">{summary}</div> : null}
    </div>
  );
}

function UserInputResultCard({ activity }: { activity: TimelineActivity }) {
  // Consolidated card: show questions + answers together
  const answerLines = activity.body?.split(/\r?\n/).filter(Boolean) ?? [];

  return (
    <div className="user-input-card answered">
      <div className="user-input-card-header">
        <span className="summary-card-badge">
          <CheckIcon size={12} />
          User Input
        </span>
      </div>
      {answerLines.length > 0 ? (
        <div className="user-input-answer-list">
          {answerLines.map((line, index) => (
            <div key={index} className="user-input-answer-row">{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ activity }: { activity: TimelineActivity }) {
  return <div className="chat-status-line">{activity.title}</div>;
}

function RunMessages({ run }: { run: AgentRun }) {
  const activities = deriveTimelineActivities(run.events);
  const isRunning = run.status === "running" || run.status === "queued";
  const hasPendingTool = activities.some((activity) => activity.kind === "tool" && !activity.resolved);
  const hasAssistantMessage = activities.some((activity) => activity.kind === "assistant" && activity.body);

  // Filter user_input activities: skip "Request" entries (only show when pending in popup),
  // show "Answered" entries as consolidated cards
  const filteredActivities = activities.filter((activity) => {
    if (activity.kind !== "user_input") return true;
    // Only show answered/resolved user input in chat
    return activity.title === "Answered user input";
  });

  return (
    <div className="chat-turn">
      <div className="chat-row chat-row-user">
        <div className="chat-bubble-user">
          <p>{run.prompt}</p>
        </div>
      </div>

      <div className="chat-row chat-row-agent">
        <div className="chat-agent-block">
          <div className="chat-agent-meta">
            <span className={`chat-status-dot chat-status-${run.status}`} />
            <span className="chat-agent-model">{run.modelId.split("/").pop()}</span>
            <span className="chat-meta-sep">·</span>
            <span className="chat-meta">{run.interactionMode}</span>
            <span className="chat-meta-sep">·</span>
            <span className="chat-meta">{formatRelativeTime(run.updatedAt)}</span>
          </div>

          <div className="chat-activity-flow">
            {filteredActivities.map((activity) => (
              <Fragment key={activity.id}>
                {activity.kind === "assistant" && activity.body ? <ChatMarkdown content={activity.body} /> : null}
                {activity.kind === "tool" ? <LiveToolRow activity={activity} /> : null}
                {activity.kind === "plan" && activity.body ? <ProposedPlanCard planMarkdown={activity.body} /> : null}
                {activity.kind === "completion" ? <CompletionNotice activity={activity} /> : null}
                {activity.kind === "user_input" ? <UserInputResultCard activity={activity} /> : null}
                {activity.kind === "status" ? <StatusLine activity={activity} /> : null}
                {activity.kind === "error" ? (
                  <div className="chat-error">
                    <AlertTriangleIcon size={13} />
                    <div>
                      <strong>{activity.title}</strong>
                      {activity.body ? <pre>{activity.body}</pre> : null}
                    </div>
                  </div>
                ) : null}
              </Fragment>
            ))}
          </div>

          {isRunning && !hasPendingTool && !hasAssistantMessage ? <WorkingIndicator /> : null}
        </div>
      </div>
    </div>
  );
}

interface ChatThreadProps {
  runs: AgentRun[];
}

export function ChatThread({ runs }: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      shouldAutoScroll.current = distFromBottom < 64;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current) {
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [runs]);

  if (runs.length === 0) {
    return (
      <div className="chat-empty">
        <MessageSquareIcon size={20} />
        <p>Start a new conversation</p>
        <p className="chat-empty-sub">Each chat keeps the full back and forth for one project workspace.</p>
      </div>
    );
  }

  return (
    <div className="chat-scroll" ref={scrollRef}>
      {runs.map((run) => (
        <RunMessages key={run.id} run={run} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
