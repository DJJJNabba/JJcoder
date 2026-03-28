import { Fragment, useEffect, useRef } from "react";
import {
  CheckIcon,
  AlertTriangleIcon,
  LoaderIcon,
  FileIcon,
  FileEditIcon,
  TerminalIcon,
  EyeIcon,
  PlayIcon,
  FlagIcon,
  BotIcon,
  TrashIcon,
  FolderOpenIcon
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentRun } from "@shared/types";
import { formatRelativeTime } from "@renderer/lib/format";
import { deriveTimelineActivities, type TimelineActivity } from "@renderer/lib/runTimeline";

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function extractWrittenContent(activity: TimelineActivity): string | undefined {
  if (!activity.rawInput) return undefined;
  const input = parseJson(activity.rawInput);
  return typeof input?.content === "string" ? input.content : undefined;
}

function extractReadContent(activity: TimelineActivity): string | undefined {
  if (!activity.rawOutput) return undefined;
  const output = parseJson(activity.rawOutput);
  return typeof output?.content === "string" ? output.content : undefined;
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
  const combined = (stderr || stdout).trim();
  if (!combined) return undefined;
  const lines = combined.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - 3)).join("\n");
}

function extractFinishSummary(activity: TimelineActivity): string | undefined {
  const input = activity.rawInput ? parseJson(activity.rawInput) : null;
  const output = activity.rawOutput ? parseJson(activity.rawOutput) : null;
  return typeof input?.summary === "string"
    ? input.summary
    : typeof output?.summary === "string"
      ? output.summary
      : undefined;
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

function statusIcon(activity: TimelineActivity) {
  if (!activity.resolved) return <LoaderIcon size={11} className="chat-spin" />;
  return <CheckIcon size={11} />;
}

function DiffStat({ activity }: { activity: TimelineActivity }) {
  const written = extractWrittenContent(activity);
  const read = extractReadContent(activity);

  if (activity.toolName === "write_file" && written) {
    const lines = countLines(written);
    return (
      <span className="chat-diff-stat">
        <span className="diff-add">+{lines}</span>
      </span>
    );
  }

  if (activity.toolName === "read_file" && read) {
    const lines = countLines(read);
    return <span className="chat-diff-stat">{lines} lines</span>;
  }

  if (activity.note) {
    return <span className="chat-diff-stat">{activity.note}</span>;
  }

  return null;
}

function LiveToolRow({ activity }: { activity: TimelineActivity }) {
  const filePath = extractFilePath(activity);
  const command = extractCommand(activity);
  const displayName = filePath ?? command ?? activity.title;
  const detail = getToolDetail(activity);

  return (
    <div className={`chat-inline-tool ${activity.resolved ? "resolved" : "pending"}`}>
      <div className="chat-inline-tool-header">
        <span className="chat-live-status">{statusIcon(activity)}</span>
        <span className="chat-live-icon">{toolIcon(activity)}</span>
        <span className="chat-live-name" title={displayName}>{displayName}</span>
        <DiffStat activity={activity} />
      </div>
      {detail ? <div className="chat-live-detail">{detail}</div> : null}
    </div>
  );
}

function getToolDetail(activity: TimelineActivity): string | null {
  if (!activity.resolved) return null;

  if (activity.toolName === "run_workspace_command") {
    const output = extractCommandOutput(activity);
    return output ?? "Command completed";
  }
  if (activity.toolName === "list_files") {
    return extractListFilesResult(activity) ?? null;
  }
  if (activity.toolName === "start_preview") {
    return "Preview server is running";
  }
  if (activity.toolName === "finish_build") {
    return extractFinishSummary(activity) ?? "Build marked complete";
  }
  return null;
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

function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
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
            <span className="chat-meta">{run.mode}</span>
            <span className="chat-meta-sep">·</span>
            <span className="chat-meta">{formatRelativeTime(run.updatedAt)}</span>
          </div>

          <div className="chat-activity-flow">
            {activities.map((activity) => (
              <Fragment key={activity.id}>
                {activity.kind === "assistant" && activity.body ? <ChatMarkdown content={activity.body} /> : null}
                {activity.kind === "tool" ? <LiveToolRow activity={activity} /> : null}
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
        <BotIcon size={20} />
        <p>Start a conversation</p>
        <p className="chat-empty-sub">Describe what to build and the agent will handle the rest.</p>
      </div>
    );
  }

  const sorted = [...runs].reverse();

  return (
    <div className="chat-scroll" ref={scrollRef}>
      {sorted.map((run) => (
        <RunMessages key={run.id} run={run} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
