import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { PreviewState, Website } from "@shared/types";
import {
  detectPackageManager,
  devCommandFor,
  fileExists,
  getFreePort,
  installCommandFor,
  terminateChildProcess
} from "./utils";
import { resolvePackageManagerForWorkspace, runPackageManagerCommand, spawnPackageManagerCommand } from "./runtime";

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

  async startPreview(website: Website): Promise<PreviewState> {
    const existing = this.sessions.get(website.id);
    if (existing?.stopping) {
      await existing.stopPromise?.catch(() => undefined);
    } else if (existing) {
      return existing.preview;
    }

    const hasPackageJson = await fileExists(path.join(website.workspacePath, "package.json"));
    if (!hasPackageJson) {
      throw new Error("This website does not have a package.json yet.");
    }

    const detectedPackageManager = detectPackageManager(website.workspacePath);
    const { packageManager } = await resolvePackageManagerForWorkspace(detectedPackageManager);
    const nodeModulesPath = path.join(website.workspacePath, "node_modules");
    if (!(await fileExists(nodeModulesPath))) {
      const installResult = await runPackageManagerCommand(installCommandFor(packageManager), website.workspacePath);
      if (installResult.exitCode !== 0) {
        throw new Error(installResult.stderr.trim() || installResult.stdout.trim() || "Failed to install dependencies.");
      }
    }

    const port = await getFreePort();
    const command = devCommandFor(packageManager, port);
    const preview: PreviewState = {
      status: "starting",
      port,
      url: `http://127.0.0.1:${port}`,
      command,
      lastOutput: null,
      lastStartedAt: new Date().toISOString()
    };

    await this.onPreviewChange(website.id, preview);

    const spawned = await spawnPackageManagerCommand(command, website.workspacePath);
    const child = spawned.child;

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
      void this.onPreviewChange(website.id, {
        ...session.preview,
        status,
        port: null,
        url: null,
        command: null,
        lastOutput:
          code === 0
            ? "Preview server stopped."
            : `Preview server exited unexpectedly with code ${code ?? "unknown"}.`
      });
    });

    this.sessions.set(website.id, {
      child,
      preview: {
        ...preview,
        command: spawned.displayCommand
      },
      stopping: false,
      stopPromise: null
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
