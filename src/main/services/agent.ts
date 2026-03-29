import fs from "node:fs/promises";
import path from "node:path";
import { OpenRouter, hasToolCall, stepCountIs, tool } from "@openrouter/sdk";
import { z } from "zod";
import type { InteractionMode, PendingUserInputQuestion, ProposedPlan, RunEvent, Website } from "@shared/types";
import {
  buildCommandFor,
  detectPackageManager,
  listFilesRecursive,
  readTextFileSafe,
  relativeToWorkspace,
  resolveWithinWorkspace,
  writeTextFileSafe
} from "./utils";
import { runPackageManagerCommand } from "./runtime";

export interface AgentRuntimeCallbacks {
  appendEvent: (event: Omit<RunEvent, "id" | "createdAt">) => Promise<void>;
  setStatus: (status: string) => Promise<void>;
  startPreview: () => Promise<void>;
  savePlan: (input: { title: string; planMarkdown: string }) => Promise<ProposedPlan>;
  requestUserInput: (input: { questions: PendingUserInputQuestion[] }) => Promise<Record<string, string>>;
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
    "Prefer npm commands unless the workspace clearly already uses pnpm, yarn, or bun.",
    "Always verify the app with a build command before finishing.",
    "Keep changes inside the workspace root and prefer full-file rewrites when they are simpler than brittle search/replace edits.",
    "When the task is complete, call finish_build with a concise ship note.",
    "Keep chat updates short and sparse.",
    "Do not narrate every obvious step or repeat yourself.",
    "Prefer tools for observable actions and reserve assistant text for meaningful progress updates."
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

function createPlanPrompt(workspacePath: string, hasExistingFiles: boolean): string {
  const base = [
    "You are JJcoder in plan mode.",
    "You are operating inside a React + Vite website workspace.",
    `Workspace root: ${workspacePath}`,
    "You must inspect the codebase and return a concrete implementation plan only.",
    "Do not modify files. Do not pretend work is done. Do not call mutating tools.",
    "Return exactly one <proposed_plan> block.",
    "Inside it, include a title, summary, likely files to change, verification steps, and assumptions.",
    "Keep it concrete to the current workspace and request. Avoid generic PM boilerplate."
  ];

  if (hasExistingFiles) {
    base.push("This workspace already contains source files. Inspect before planning and preserve existing patterns.");
  } else {
    base.push("This workspace has little or no source code yet. Plan the initial site structure and files to create.");
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

function extractProposedPlanBlock(text: string): string | null {
  const match = text.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
  const plan = match?.[1]?.trim();
  return plan ? plan : null;
}

function derivePlanTitle(planMarkdown: string): string {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : "Implementation plan";
}

function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`;
}

function normalizePendingUserInputQuestions(
  questions: Array<{
    header: string;
    id: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    allowFreeform?: boolean;
  }>
): PendingUserInputQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    header: question.header,
    question: question.question,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description
    })),
    allowFreeform: question.allowFreeform ?? true
  }));
}

export async function executeWebsiteRun(options: {
  apiKey: string;
  website: Website;
  conversationHistory: string;
  prompt: string;
  modelId: string;
  interactionMode: InteractionMode;
  allowBundledRuntime: boolean;
  sourcePlanId: string | null;
  signal: AbortSignal;
  callbacks: AgentRuntimeCallbacks;
}): Promise<string> {
  if (options.interactionMode === "plan") {
    return await executeWebsitePlanRun(options);
  }
  return await executeWebsiteChatRun(options);
}

async function executeWebsiteChatRun(options: {
  apiKey: string;
  website: Website;
  conversationHistory: string;
  prompt: string;
  modelId: string;
  interactionMode: InteractionMode;
  allowBundledRuntime: boolean;
  sourcePlanId: string | null;
  signal: AbortSignal;
  callbacks: AgentRuntimeCallbacks;
}): Promise<string> {
  const client = new OpenRouter({
    apiKey: options.apiKey
  });

  let finalSummary = "";
  const plannerOutput = null;

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
      const result = await runPackageManagerCommand(command, workspacePath, {
        allowBundledRuntime: options.allowBundledRuntime
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `Command failed: ${command}`);
      }
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
  options.signal.throwIfAborted();
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
              options.conversationHistory ? `Previous conversation turns:\n${options.conversationHistory}\n` : "",
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
      tool({
        name: "request_user_input",
        description:
          "Pause and ask the user 1-3 structured questions when a real product decision is required.",
        inputSchema: z.object({
          questions: z
            .array(
              z.object({
                header: z.string(),
                id: z.string(),
                question: z.string(),
                options: z.array(
                  z.object({
                    label: z.string(),
                    description: z.string()
                  })
                ),
                allowFreeform: z.boolean().optional()
              })
            )
            .min(1)
            .max(3)
        }),
        execute: async ({ questions }) => {
          const normalizedQuestions = normalizePendingUserInputQuestions(questions);
          const answers = await options.callbacks.requestUserInput({
            questions: normalizedQuestions
          });
          return { answers };
        }
      }),
      finishTool
    ],
    stopWhen: [stepCountIs(20), hasToolCall("finish_build")]
  }, {
    signal: options.signal
  });

  for await (const event of builderResult.getFullResponsesStream()) {
    options.signal.throwIfAborted();
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

  options.signal.throwIfAborted();
  const builderText = await builderResult.getText();
  options.signal.throwIfAborted();
  if (builderText.trim() && assistantDraftsByItemId.size === 0) {
    await options.callbacks.appendEvent({
      agent: "builder",
      type: "assistant",
      title: "Builder output",
      content: builderText.trim()
    });
  }

  options.signal.throwIfAborted();
  await options.callbacks.startPreview().catch(() => undefined);
  return finalSummary || builderText.trim() || "Website build complete.";
}

async function executeWebsitePlanRun(options: {
  apiKey: string;
  website: Website;
  conversationHistory: string;
  prompt: string;
  modelId: string;
  interactionMode: InteractionMode;
  sourcePlanId: string | null;
  signal: AbortSignal;
  callbacks: AgentRuntimeCallbacks;
}): Promise<string> {
  const client = new OpenRouter({
    apiKey: options.apiKey
  });
  const workspacePath = options.website.workspacePath;
  const hasExistingFiles = await hasSourceFiles(workspacePath);
  const buildContext = await readProjectSnapshot(workspacePath);

  const builderResult = client.callModel({
    model: options.modelId,
    instructions: createPlanPrompt(workspacePath, hasExistingFiles),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              options.conversationHistory ? `Previous conversation turns:\n${options.conversationHistory}\n` : "",
              `User request:\n${options.prompt}\n`,
              `Project snapshot:\n${buildContext}\n`
            ].join("\n")
          }
        ]
      }
    ],
    tools: [
      tool({
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
      }),
      tool({
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
      })
    ],
    stopWhen: [stepCountIs(12)]
  }, {
    signal: options.signal
  });

  const toolNamesByCallId = new Map<string, string>();
  for await (const event of builderResult.getFullResponsesStream()) {
    options.signal.throwIfAborted();
    if (event.type === "response.function_call_arguments.done") {
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
      continue;
    }

    if (event.type === "tool.result") {
      await options.callbacks.appendEvent({
        agent: "builder",
        type: "tool",
        title: "Tool result",
        content: stringifyContent(event.result),
        metadata: {
          toolName: toolNamesByCallId.get(event.toolCallId) ?? null,
          toolPhase: "result",
          toolCallId: event.toolCallId
        }
      });
    }
  }

  options.signal.throwIfAborted();
  const text = (await builderResult.getText()).trim();
  options.signal.throwIfAborted();
  const planMarkdown = extractProposedPlanBlock(text);
  if (!planMarkdown) {
    throw new Error("Plan mode requires a valid <proposed_plan>...</proposed_plan> block.");
  }

  const title = derivePlanTitle(planMarkdown);
  await options.callbacks.savePlan({
    title,
    planMarkdown
  });
  return title;
}

export { buildPlanImplementationPrompt, derivePlanTitle, extractProposedPlanBlock };
