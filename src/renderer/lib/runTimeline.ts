import type { RunEvent } from "@shared/types";

export type TimelineTone = "info" | "tool" | "error";

export interface TimelineActivity {
  id: string;
  tone: TimelineTone;
  kind: "status" | "assistant" | "tool" | "plan" | "completion" | "user_input" | "error";
  agent: RunEvent["agent"];
  createdAt: string;
  title: string;
  body?: string;
  note?: string;
  tag?: string;
  rawInput?: string;
  rawOutput?: string;
  toolName?: string;
  resolved?: boolean;
}

interface ToolSummary {
  title: string;
  note?: string;
}

export function deriveTimelineActivities(events: RunEvent[]): TimelineActivity[] {
  const activities: TimelineActivity[] = [];
  const toolActivityIndexByCallId = new Map<string, number>();
  const unresolvedToolIndices: number[] = [];
  const assistantActivityIndexByStreamKey = new Map<string, number>();

  for (const event of events) {
    if (isToolCallEvent(event)) {
      const toolName = readMetadata(event, "toolName") ?? event.title;
      const callId = readMetadata(event, "toolCallId");
      const summary = summarizeToolCall(toolName, event.content);
      const activity: TimelineActivity = {
        id: event.id,
        tone: "tool",
        kind: "tool",
        agent: event.agent,
        createdAt: event.createdAt,
        title: summary.title,
        note: summary.note,
        tag: "tool",
        rawInput: event.content,
        toolName,
        resolved: false
      };

      activities.push(activity);
      const index = activities.length - 1;
      unresolvedToolIndices.push(index);
      if (callId) {
        toolActivityIndexByCallId.set(callId, index);
      }
      continue;
    }

    if (isToolResultEvent(event)) {
      const callId = readMetadata(event, "toolCallId");
      const resolvedIndex = findToolActivityIndex(activities, unresolvedToolIndices, event.agent, callId, toolActivityIndexByCallId);
      if (resolvedIndex !== null) {
        const activity = activities[resolvedIndex];
        const summary = summarizeToolResult(activity.toolName ?? "tool", event.content);
        if ((activity.toolName ?? "tool") === "finish_build") {
          activity.kind = "completion";
          activity.tone = "info";
          activity.tag = "completion";
        }
        activity.note = summary.note ?? activity.note;
        activity.body = summary.body ?? activity.body;
        activity.rawOutput = event.content;
        activity.resolved = true;

        const unresolvedIndex = unresolvedToolIndices.indexOf(resolvedIndex);
        if (unresolvedIndex >= 0) {
          unresolvedToolIndices.splice(unresolvedIndex, 1);
        }
        continue;
      }

      const toolName = inferToolResultName(event, event.content);
      const summary = summarizeToolResult(toolName, event.content);
      activities.push({
        id: event.id,
        tone: toolName === "finish_build" ? "info" : "tool",
        kind: toolName === "finish_build" ? "completion" : "tool",
        agent: event.agent,
        createdAt: event.createdAt,
        title: summary.title,
        note: summary.note,
        body: summary.body,
        tag: "output",
        rawOutput: event.content,
        toolName,
        resolved: true
      });
      continue;
    }

    if (event.type === "error") {
      activities.push({
        id: event.id,
        tone: "error",
        kind: "error",
        agent: event.agent,
        createdAt: event.createdAt,
        title: event.title,
        body: event.content,
        tag: "error"
      });
      continue;
    }

    if (event.type === "assistant" || event.type === "assistant_delta") {
      const activity: TimelineActivity = {
        id: event.id,
        tone: "info",
        kind: "assistant",
        agent: event.agent,
        createdAt: event.createdAt,
        title: event.title,
        body: event.content,
        tag: "note"
      };
      const streamKey = readMetadata(event, "streamKey");
      if (streamKey) {
        const existingIndex = assistantActivityIndexByStreamKey.get(streamKey);
        if (typeof existingIndex === "number") {
          activities[existingIndex] = activity;
          continue;
        }
        assistantActivityIndexByStreamKey.set(streamKey, activities.length);
      }
      activities.push(activity);
      continue;
    }

    if (event.type === "plan") {
      activities.push({
        id: event.id,
        tone: "info",
        kind: "plan",
        agent: event.agent,
        createdAt: event.createdAt,
        title: event.title,
        body: event.content,
        tag: "plan"
      });
      continue;
    }

    if (event.type === "completion") {
      activities.push({
        id: event.id,
        tone: "info",
        kind: "completion",
        agent: event.agent,
        createdAt: event.createdAt,
        title: event.title,
        body: event.content,
        tag: "completion"
      });
      continue;
    }

    if (event.type === "user_input") {
      activities.push({
        id: event.id,
        tone: "info",
        kind: "user_input",
        agent: event.agent,
        createdAt: event.createdAt,
        title: event.title,
        body: event.content,
        tag: "user_input"
      });
      continue;
    }

    if (event.metadata?.visibility === "debug") {
      continue;
    }

    activities.push({
      id: event.id,
      tone: "info",
      kind: "status",
      agent: event.agent,
      createdAt: event.createdAt,
      title: event.content,
      tag: "info"
    });
  }

  return activities;
}

function findToolActivityIndex(
  activities: TimelineActivity[],
  unresolvedToolIndices: number[],
  agent: RunEvent["agent"],
  callId: string | undefined,
  toolActivityIndexByCallId: Map<string, number>
): number | null {
  if (callId) {
    const activityIndex = toolActivityIndexByCallId.get(callId);
    if (typeof activityIndex === "number") {
      return activityIndex;
    }
  }

  for (let index = unresolvedToolIndices.length - 1; index >= 0; index -= 1) {
    const activityIndex = unresolvedToolIndices[index];
    const activity = activities[activityIndex];
    if (activity && activity.agent === agent && activity.kind === "tool" && !activity.resolved) {
      return activityIndex;
    }
  }

  return null;
}

function isToolCallEvent(event: RunEvent): boolean {
  if (event.type !== "tool") {
    return false;
  }

  return (readMetadata(event, "toolPhase") ?? "call") === "call";
}

function isToolResultEvent(event: RunEvent): boolean {
  if (event.type === "tool") {
    return readMetadata(event, "toolPhase") === "result";
  }

  return event.type === "status" && event.title === "Tool result";
}

function readMetadata(event: RunEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function inferToolResultName(event: RunEvent, rawOutput: string): string {
  const explicitToolName = readMetadata(event, "toolName");
  if (explicitToolName) {
    return explicitToolName;
  }

  const output = parseRecord(rawOutput);
  if (typeof output?.summary === "string") {
    return "finish_build";
  }

  return "tool";
}

function summarizeToolCall(toolName: string, rawInput: string): ToolSummary {
  const input = parseRecord(rawInput);
  switch (toolName) {
    case "read_file": {
      const targetPath = readString(input, "path");
      return {
        title: targetPath ? `Read ${targetPath}` : "Read file"
      };
    }
    case "write_file": {
      const targetPath = readString(input, "path");
      return {
        title: targetPath ? `Wrote ${targetPath}` : "Wrote file"
      };
    }
    case "delete_file": {
      const targetPath = readString(input, "path");
      return {
        title: targetPath ? `Deleted ${targetPath}` : "Deleted file"
      };
    }
    case "list_files": {
      const targetPath = readString(input, "path");
      return {
        title: targetPath ? `Listed ${targetPath}` : "Listed workspace files"
      };
    }
    case "run_workspace_command": {
      const command = readString(input, "command");
      return {
        title: command ? `Ran ${command}` : "Ran workspace command"
      };
    }
    case "start_preview":
      return {
        title: "Started preview"
      };
    case "finish_build":
      return {
        title: "Build complete"
      };
    default:
      return {
        title: humanizeToolName(toolName)
      };
  }
}

function summarizeToolResult(
  toolName: string,
  rawOutput: string
): {
  title: string;
  note?: string;
  body?: string;
} {
  const output = parseRecord(rawOutput);
  switch (toolName) {
    case "read_file": {
      const targetPath = readString(output, "path");
      const content = readString(output, "content");
      return {
        title: targetPath ? `Read ${targetPath}` : "Read file",
        note: content ? summarizeTextLength(content) : "Loaded file contents"
      };
    }
    case "write_file": {
      const targetPath = readString(output, "path");
      const bytes = readNumber(output, "bytes");
      return {
        title: targetPath ? `Wrote ${targetPath}` : "Wrote file",
        note: typeof bytes === "number" ? `${formatBytes(bytes)} written` : "Saved changes"
      };
    }
    case "delete_file": {
      const targetPath = readString(output, "path");
      return {
        title: targetPath ? `Deleted ${targetPath}` : "Deleted file",
        note: "Removed from workspace"
      };
    }
    case "list_files": {
      const total = readNumber(output, "total");
      const files = Array.isArray(output?.files) ? output.files : null;
      return {
        title: "Listed files",
        note:
          typeof total === "number"
            ? `${total} file${total === 1 ? "" : "s"} found`
            : files
              ? `${files.length} file${files.length === 1 ? "" : "s"} found`
              : "Workspace files loaded"
      };
    }
    case "run_workspace_command": {
      const command = readString(output, "command");
      const stdout = stripAnsi(readString(output, "stdout") ?? "");
      const stderr = stripAnsi(readString(output, "stderr") ?? "");
      const note = summarizeCommandOutput(stdout, stderr);
      return {
        title: command ? `Ran ${command}` : "Ran workspace command",
        note,
        body: buildCommandExcerpt(stdout, stderr)
      };
    }
    case "start_preview":
      return {
        title: "Started preview",
        note: "Preview server is running"
      };
    case "finish_build": {
      const summary = readString(output, "summary");
      return {
        title: "Build complete",
        note: summary ? trimSentence(summary, 140) : "Build marked complete",
        body: summary
      };
    }
    default:
      return {
        title: humanizeToolName(toolName),
        note: "Tool completed"
      };
  }
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeTextLength(value: string): string {
  const lines = value.split(/\r?\n/).length;
  return `${lines} line${lines === 1 ? "" : "s"} loaded`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function summarizeCommandOutput(stdout: string, stderr: string): string {
  const lines = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "Command completed";
  }

  const preferredLine =
    lines.find((line) => /added \d+ packages/i.test(line)) ??
    lines.find((line) => /found 0 vulnerabilities/i.test(line)) ??
    lines.find((line) => /built in /i.test(line)) ??
    lines.find((line) => /error/i.test(line)) ??
    lines[0];

  return trimSentence(preferredLine, 140);
}

function buildCommandExcerpt(stdout: string, stderr: string): string | undefined {
  const lines = (stderr.trim() || stdout.trim())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return undefined;
  }

  return lines.slice(Math.max(0, lines.length - 3)).join("\n");
}

function trimSentence(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 3).trimEnd()}...`;
}
