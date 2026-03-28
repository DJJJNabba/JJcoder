import fs from "node:fs/promises";
import path from "node:path";
import { OpenRouter, hasToolCall, stepCountIs, tool } from "@openrouter/sdk";
import { z } from "zod";
import type { AgentMode, RunEvent, Website } from "@shared/types";
import {
  buildCommandFor,
  detectPackageManager,
  listFilesRecursive,
  readTextFileSafe,
  relativeToWorkspace,
  resolveWithinWorkspace,
  runCommandOrThrow,
  writeTextFileSafe
} from "./utils";

export interface AgentRuntimeCallbacks {
  appendEvent: (event: Omit<RunEvent, "id" | "createdAt">) => Promise<void>;
  setStatus: (status: string) => Promise<void>;
  startPreview: () => Promise<void>;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value ?? {}, null, 2);
}

function parseOrStringifyArguments(rawArguments: string): string {
  try {
    return JSON.stringify(JSON.parse(rawArguments), null, 2);
  } catch {
    return rawArguments;
  }
}

function summarizePreliminaryResult(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "status", "summary", "detail"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function createSystemPrompt(workspacePath: string, hasExistingFiles: boolean): string {
  const base = [
    "You are JJcoder, an expert website-building agent.",
    "You are operating inside a React + Vite website workspace.",
    `Workspace root: ${workspacePath}`,
    "Build polished React websites with strong visual direction, production-ready code, and clean file structure.",
    "Use tools to inspect, edit, install, build, and preview the site.",
    "Always verify the app with a build command before finishing.",
    "Keep changes inside the workspace root and prefer full-file rewrites when they are simpler than brittle search/replace edits.",
    "When the task is complete, call finish_build with a concise ship note."
  ];

  if (hasExistingFiles) {
    base.push(
      "",
      "IMPORTANT: This workspace already has source files.",
      "Before making changes, use list_files and read_file to understand the existing codebase.",
      "Preserve existing patterns, styles, and architecture unless the user asks you to change them.",
      "Build on top of what exists rather than replacing everything."
    );
  } else {
    base.push(
      "",
      "IMPORTANT: This workspace has only build tooling (package.json, vite config, etc.) — no source files yet.",
      "You must create all source files from scratch: src/main.tsx, src/App.tsx, styles, and any other components.",
      "Design and build the entire site based on the user's request. Do not use placeholder or generic template content.",
      "Create a distinctive, polished design that directly addresses what the user asked for."
    );
  }

  return base.join("\n");
}

function commandAllowed(command: string): boolean {
  return /^(npm|pnpm|yarn|bun)\s+(install|run\s+[a-z0-9:_-]+|add\s+.+)$/i.test(command.trim());
}

async function hasSourceFiles(workspacePath: string): Promise<boolean> {
  const srcDir = path.join(workspacePath, "src");
  try {
    const entries = await fs.readdir(srcDir);
    return entries.some((e) => e.endsWith(".tsx") || e.endsWith(".ts") || e.endsWith(".jsx") || e.endsWith(".js"));
  } catch {
    return false;
  }
}

async function readProjectSnapshot(workspacePath: string): Promise<string> {
  const packageJsonPath = path.join(workspacePath, "package.json");
  const files = await listFilesRecursive(workspacePath);
  const packageJson = await readTextFileSafe(packageJsonPath).catch(() => "{}");
  return [
    "Workspace files:",
    files.slice(0, 300).join("\n"),
    "",
    "package.json:",
    packageJson.slice(0, 5000)
  ].join("\n");
}

async function runPlannerPhase(client: OpenRouter, modelId: string, prompt: string, website: Website) {
  const planner = client.callModel({
    model: modelId,
    instructions: [
      "You are the planning agent for JJcoder.",
      "Return a concise implementation plan for this website build request.",
      "Mention likely files, dependencies, visual direction, and how to verify the result."
    ].join("\n"),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Website: ${website.name}\nRequest: ${prompt}\n\nCurrent context:\n${await readProjectSnapshot(
              website.workspacePath
            )}`
          }
        ]
      }
    ]
  });

  return await planner.getText();
}

export async function executeWebsiteAgentRun(options: {
  apiKey: string;
  website: Website;
  prompt: string;
  modelId: string;
  mode: AgentMode;
  callbacks: AgentRuntimeCallbacks;
}): Promise<string> {
  const client = new OpenRouter({
    apiKey: options.apiKey
  });

  let finalSummary = "";
  const plannerOutput =
    options.mode === "squad"
      ? await runPlannerPhase(client, options.modelId, options.prompt, options.website)
      : null;

  if (plannerOutput) {
    await options.callbacks.appendEvent({
      agent: "planner",
      type: "assistant",
      title: "Planner brief",
      content: plannerOutput
    });
  }

  const workspacePath = options.website.workspacePath;
  const buildCommand = buildCommandFor(detectPackageManager(workspacePath));

  const listFilesTool = tool({
    name: "list_files",
    description: "List files inside the website workspace.",
    inputSchema: z.object({
      path: z.string().optional().describe("Relative path inside the workspace.")
    }),
    execute: async ({ path: relativePath }) => {
      const safeRelative = relativePath ? relativeToWorkspace(workspacePath, relativePath) : "";
      const files = await listFilesRecursive(workspacePath, safeRelative);
      return {
        files: files.slice(0, 400),
        total: files.length
      };
    }
  });

  const readFileTool = tool({
    name: "read_file",
    description: "Read a text file from the website workspace.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file.")
    }),
    execute: async ({ path: targetPath }) => {
      const filePath = resolveWithinWorkspace(workspacePath, targetPath);
      const contents = await readTextFileSafe(filePath);
      return {
        path: targetPath,
        content: contents.slice(0, 20000)
      };
    }
  });

  const writeFileTool = tool({
    name: "write_file",
    description: "Create or replace a file inside the website workspace.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file."),
      content: z.string().describe("Full file contents.")
    }),
    execute: async ({ path: targetPath, content }) => {
      const filePath = resolveWithinWorkspace(workspacePath, targetPath);
      await writeTextFileSafe(filePath, content);
      return {
        path: targetPath,
        bytes: Buffer.byteLength(content, "utf8")
      };
    }
  });

  const deleteFileTool = tool({
    name: "delete_file",
    description: "Delete a file inside the website workspace.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file.")
    }),
    execute: async ({ path: targetPath }) => {
      const filePath = resolveWithinWorkspace(workspacePath, targetPath);
      await fs.rm(filePath, { force: true });
      return {
        path: targetPath,
        deleted: true
      };
    }
  });

  const runCommandTool = tool({
    name: "run_workspace_command",
    description: "Run a package manager command in the website workspace.",
    inputSchema: z.object({
      command: z.string().describe("Allowed commands include npm/pnpm/yarn/bun install, add, and run scripts.")
    }),
    execute: async ({ command }) => {
      if (!commandAllowed(command)) {
        throw new Error("That command is outside JJcoder's allowed workspace command policy.");
      }
      const result = await runCommandOrThrow(command, workspacePath);
      return {
        command,
        stdout: result.stdout.slice(-4000),
        stderr: result.stderr.slice(-4000)
      };
    }
  });

  const startPreviewTool = tool({
    name: "start_preview",
    description: "Start or refresh the website preview server.",
    inputSchema: z.object({}),
    execute: async () => {
      await options.callbacks.startPreview();
      return {
        started: true
      };
    }
  });

  const finishTool = tool({
    name: "finish_build",
    description: "Finish the website task once the build passes and the site is ready.",
    inputSchema: z.object({
      summary: z.string().describe("A concise ship note covering the delivered website.")
    }),
    execute: async ({ summary }) => {
      finalSummary = summary;
      return {
        summary
      };
    }
  });

  const buildContext = await readProjectSnapshot(workspacePath);
  const hasExistingFiles = await hasSourceFiles(workspacePath);
  await options.callbacks.setStatus("Dispatching builder agent.");
  const toolNamesByCallId = new Map<string, string>();
  const assistantDraftsByItemId = new Map<string, string>();

  const builderResult = client.callModel({
    model: options.modelId,
    instructions: createSystemPrompt(workspacePath, hasExistingFiles),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              plannerOutput ? `Planner brief:\n${plannerOutput}\n` : "",
              `User request:\n${options.prompt}\n`,
              `Project snapshot:\n${buildContext}\n`,
              `Required verification command: ${buildCommand}`
            ].join("\n")
          }
        ]
      }
    ],
    tools: [
      listFilesTool,
      readFileTool,
      writeFileTool,
      deleteFileTool,
      runCommandTool,
      startPreviewTool,
      finishTool
    ],
    stopWhen: [stepCountIs(20), hasToolCall("finish_build")]
  });

  for await (const event of builderResult.getFullResponsesStream()) {
    switch (event.type) {
      case "response.function_call_arguments.done": {
        toolNamesByCallId.set(event.itemId, event.name);
        await options.callbacks.appendEvent({
          agent: "builder",
          type: "tool",
          title: event.name,
          content: parseOrStringifyArguments(event.arguments),
          metadata: {
            toolName: event.name,
            toolPhase: "call",
            toolCallId: event.itemId
          }
        });
        break;
      }
      case "tool.result": {
        const toolName = toolNamesByCallId.get(event.toolCallId) ?? null;
        await options.callbacks.appendEvent({
          agent: "builder",
          type: "tool",
          title: "Tool result",
          content: stringifyContent(event.result),
          metadata: {
            toolName,
            toolPhase: "result",
            toolCallId: event.toolCallId
          }
        });
        break;
      }
      case "tool.preliminary_result": {
        const summary = summarizePreliminaryResult(event.result);
        if (!summary) {
          break;
        }
        await options.callbacks.appendEvent({
          agent: "builder",
          type: "status",
          title: "Status",
          content: summary
        });
        break;
      }
      case "response.output_text.delta": {
        const streamKey = `builder:assistant:${event.itemId}`;
        const nextDraft = `${assistantDraftsByItemId.get(event.itemId) ?? ""}${event.delta}`;
        assistantDraftsByItemId.set(event.itemId, nextDraft);
        await options.callbacks.appendEvent({
          agent: "builder",
          type: "assistant_delta",
          title: "Builder output",
          content: nextDraft,
          metadata: {
            streamKey,
            replace: true
          }
        });
        break;
      }
      default:
        break;
    }
  }

  const builderText = await builderResult.getText();
  if (builderText.trim() && assistantDraftsByItemId.size === 0) {
    await options.callbacks.appendEvent({
      agent: "builder",
      type: "assistant",
      title: "Builder output",
      content: builderText.trim()
    });
  }

  if (options.mode === "squad") {
    await options.callbacks.setStatus("Dispatching reviewer agent.");
    const reviewResult = client.callModel({
      model: options.modelId,
      instructions: [
        "You are the review agent for JJcoder.",
        "Write a concise release note for the completed website build.",
        "Focus on outcome, verification, and anything the user should inspect next."
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Original request:\n${options.prompt}\n\nBuilder summary:\n${finalSummary || builderText}`
            }
          ]
        }
      ]
    });
    const reviewText = await reviewResult.getText();
    if (reviewText.trim()) {
      await options.callbacks.appendEvent({
        agent: "reviewer",
        type: "assistant",
        title: "Reviewer note",
        content: reviewText.trim()
      });
    }
  }

  await options.callbacks.startPreview().catch(() => undefined);
  return finalSummary || builderText.trim() || "Website build complete.";
}
