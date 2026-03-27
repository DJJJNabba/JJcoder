import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { PreviewState, Website } from "@shared/types";
import {
  detectPackageManager,
  devCommandFor,
  fileExists,
  getFreePort,
  installCommandFor,
  runCommandOrThrow
} from "./utils";

interface PreviewSession {
  child: ChildProcess;
  preview: PreviewState;
}

export class PreviewManager {
  private readonly sessions = new Map<string, PreviewSession>();

  constructor(
    private readonly onPreviewChange: (websiteId: string, preview: PreviewState) => Promise<void>
  ) {}

  async startPreview(website: Website): Promise<PreviewState> {
    const existing = this.sessions.get(website.id);
    if (existing) {
      return existing.preview;
    }

    const hasPackageJson = await fileExists(path.join(website.workspacePath, "package.json"));
    if (!hasPackageJson) {
      throw new Error("This website does not have a package.json yet.");
    }

    const packageManager = detectPackageManager(website.workspacePath);
    const nodeModulesPath = path.join(website.workspacePath, "node_modules");
    if (!(await fileExists(nodeModulesPath))) {
      await runCommandOrThrow(installCommandFor(packageManager), website.workspacePath);
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

    const child = spawn(command, {
      cwd: website.workspacePath,
      env: {
        ...process.env,
        BROWSER: "none",
        CI: "1"
      },
      shell: true,
      windowsHide: true
    });

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

    child.stdout.on("data", (chunk) => {
      void handleChunk(chunk);
    });
    child.stderr.on("data", (chunk) => {
      void handleChunk(chunk);
    });

    child.on("exit", (code) => {
      const status: PreviewState["status"] = code === 0 ? "stopped" : "error";
      void updatePreview({
        status,
        lastOutput:
          code === 0
            ? "Preview server stopped."
            : `Preview server exited unexpectedly with code ${code ?? "unknown"}.`
      });
      this.sessions.delete(website.id);
    });

    this.sessions.set(website.id, {
      child,
      preview
    });

    return preview;
  }

  async stopPreview(websiteId: string): Promise<PreviewState> {
    const session = this.sessions.get(websiteId);
    if (!session) {
      return {
        status: "stopped",
        port: null,
        url: null,
        command: null,
        lastOutput: "Preview is not running.",
        lastStartedAt: null
      };
    }

    const { child } = session;
    this.sessions.delete(websiteId);
    child.kill();

    const next: PreviewState = {
      status: "stopped",
      port: null,
      url: null,
      command: null,
      lastOutput: "Preview stopped.",
      lastStartedAt: session.preview.lastStartedAt
    };
    await this.onPreviewChange(websiteId, next);
    return next;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((websiteId) => this.stopPreview(websiteId)));
  }
}
