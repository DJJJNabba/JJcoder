import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { PreviewState, Website } from "@shared/types";
import { ensureWorkspaceDependencies } from "./dependencies";
import {
  detectPackageManager,
  fileExists,
  getFreePort,
  previewCommandForWorkspace,
  terminateChildProcess
} from "./utils";
import { resolvePackageManagerForWorkspace, spawnPackageManagerCommand } from "./runtime";

const STATIC_PREVIEW_SERVER_SCRIPT = String.raw`
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[1]);
const port = Number(process.argv[2]);
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function isInsideRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const server = http.createServer((req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    let targetPath = path.resolve(root, "." + decodeURIComponent(requestUrl.pathname));
    if (!isInsideRoot(targetPath)) {
      send(res, 403, "Forbidden");
      return;
    }

    const stat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
    if (stat?.isDirectory()) {
      targetPath = path.join(targetPath, "index.html");
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      send(res, 404, "Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": mimeTypes.get(path.extname(targetPath).toLowerCase()) || "application/octet-stream"
    });
    fs.createReadStream(targetPath).pipe(res);
  } catch (error) {
    send(res, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Local: http://127.0.0.1:" + port);
});
`;

interface PreviewSession {
  child: ChildProcess;
  preview: PreviewState;
  stopping: boolean;
  stopPromise: Promise<void> | null;
}

export function createStoppedPreviewState(options?: {
  lastOutput?: string | null;
  lastStartedAt?: string | null;
}): PreviewState {
  return {
    status: "stopped",
    port: null,
    url: null,
    command: null,
    lastOutput: options?.lastOutput ?? null,
    lastStartedAt: options?.lastStartedAt ?? null
  };
}

export class PreviewManager {
  private readonly sessions = new Map<string, PreviewSession>();

  constructor(
    private readonly onPreviewChange: (websiteId: string, preview: PreviewState) => Promise<void>
  ) {}

  async startPreview(
    website: Website,
    options?: {
      allowBundledRuntime?: boolean;
    }
  ): Promise<PreviewState> {
    const existing = this.sessions.get(website.id);
    if (existing?.stopping) {
      await existing.stopPromise?.catch(() => undefined);
    } else if (existing) {
      return existing.preview;
    }

    const port = await getFreePort();
    const hasPackageJson = await fileExists(path.join(website.workspacePath, "package.json"));
    const hasIndexHtml = await fileExists(path.join(website.workspacePath, "index.html"));
    const command = hasPackageJson
      ? "Resolving preview command..."
      : hasIndexHtml
        ? `static preview --host 127.0.0.1 --port ${port}`
        : null;
    if (!command) {
      throw new Error("This website does not have a package.json or index.html that JJcoder can preview.");
    }

    const preview: PreviewState = {
      status: "starting",
      port,
      url: `http://127.0.0.1:${port}`,
      command,
      lastOutput: null,
      lastStartedAt: new Date().toISOString()
    };

    await this.onPreviewChange(website.id, preview);

    let spawned: {
      child: ChildProcess;
      displayCommand: string;
    };
    try {
      if (hasPackageJson) {
        const detectedPackageManager = detectPackageManager(website.workspacePath);
        const { packageManager } = await resolvePackageManagerForWorkspace(detectedPackageManager, options);
        await ensureWorkspaceDependencies({
          workspacePath: website.workspacePath,
          packageManager,
          allowBundledRuntime: options?.allowBundledRuntime
        });
        const previewCommand = await previewCommandForWorkspace(website.workspacePath, packageManager, port);
        spawned = await spawnPackageManagerCommand(previewCommand, website.workspacePath, {
          ...options,
          env: {
            PORT: String(port),
            HOST: "127.0.0.1",
            HOSTNAME: "127.0.0.1"
          }
        });
      } else {
        spawned = spawnStaticPreviewServer(website.workspacePath, port);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.onPreviewChange(website.id, {
        ...preview,
        status: "error",
        port: null,
        url: null,
        command: null,
        lastOutput: detail
      });
      throw error;
    }

    const child = spawned.child;

    const session: PreviewSession = {
      child,
      preview: {
        ...preview,
        command: spawned.displayCommand
      },
      stopping: false,
      stopPromise: null
    };
    this.sessions.set(website.id, session);

    const updatePreview = async (next: Partial<PreviewState>) => {
      const session = this.sessions.get(website.id);
      const current = session?.preview ?? preview;
      const merged = { ...current, ...next };
      if (session) {
        session.preview = merged;
      }
      await this.onPreviewChange(website.id, merged);
    };

    let announcedRunning = false;
    const handleChunk = async (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (!announcedRunning && /ready in|local:\s*http/i.test(text)) {
        announcedRunning = true;
        await updatePreview({
          status: "running",
          lastOutput: text.trim()
        });
        return;
      }
      await updatePreview({
        lastOutput: text.trim().slice(-2000)
      });
    };

    child.stdout?.on("data", (chunk) => {
      void handleChunk(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      void handleChunk(chunk);
    });

    child.on("error", (error) => {
      const session = this.sessions.get(website.id);
      if (!session || session.child !== child) {
        return;
      }

      this.sessions.delete(website.id);
      if (session.stopping) {
        return;
      }

      void this.onPreviewChange(website.id, {
        ...session.preview,
        status: "error",
        port: null,
        url: null,
        command: null,
        lastOutput: error.message || "Preview server failed to start."
      });
    });

    child.on("exit", (code) => {
      const session = this.sessions.get(website.id);
      if (!session || session.child !== child) {
        return;
      }

      this.sessions.delete(website.id);
      if (session.stopping) {
        return;
      }

      const status: PreviewState["status"] = code === 0 ? "stopped" : "error";
      const previousOutput = session.preview.lastOutput?.trim();
      void this.onPreviewChange(website.id, {
        ...session.preview,
        status,
        port: null,
        url: null,
        command: null,
        lastOutput:
          code === 0
            ? "Preview server stopped."
            : previousOutput
              ? `${previousOutput}\n\nPreview server exited unexpectedly with code ${code ?? "unknown"}.`
              : `Preview server exited unexpectedly with code ${code ?? "unknown"}.`
      });
    });

    return {
      ...preview,
      command: spawned.displayCommand
    };
  }

  async stopPreview(websiteId: string): Promise<PreviewState> {
    const session = this.sessions.get(websiteId);
    if (!session) {
      const next = createStoppedPreviewState({
        lastOutput: "Preview is not running."
      });
      await this.onPreviewChange(websiteId, next);
      return next;
    }

    const next = createStoppedPreviewState({
      lastOutput: "Preview stopped.",
      lastStartedAt: session.preview.lastStartedAt
    });
    session.stopping = true;
    session.preview = next;
    await this.onPreviewChange(websiteId, next);
    session.stopPromise ??= terminateChildProcess(session.child).finally(() => {
      const current = this.sessions.get(websiteId);
      if (current === session) {
        this.sessions.delete(websiteId);
      }
    });
    await session.stopPromise;
    return next;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((websiteId) => this.stopPreview(websiteId)));
  }
}

function spawnStaticPreviewServer(workspacePath: string, port: number): {
  child: ChildProcess;
  displayCommand: string;
} {
  const child = spawn(process.execPath, ["-e", STATIC_PREVIEW_SERVER_SCRIPT, workspacePath, String(port)], {
    cwd: workspacePath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    },
    windowsHide: true
  });

  return {
    child,
    displayCommand: `static preview --host 127.0.0.1 --port ${port}`
  };
}
