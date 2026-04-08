import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export interface CommandResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface PackageJsonShape {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath).catch(async () => {
    await fs.copyFile(temporaryPath, filePath);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  });
}

export function sanitizeProjectName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a preview port.")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function runCommand(
  command: string,
  cwd: string,
  onOutput?: (chunk: string) => void
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: {
        ...process.env,
        CI: "1"
      },
      shell: true,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.(text);
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        command,
        cwd,
        stdout,
        stderr,
        exitCode: exitCode ?? 0
      });
    });
  });
}

export async function runCommandOrThrow(
  command: string,
  cwd: string,
  onOutput?: (chunk: string) => void
): Promise<CommandResult> {
  const result = await runCommand(command, cwd, onOutput);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Command failed: ${command}`);
  }
  return result;
}

export async function terminateChildProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    const result = await runCommand(`taskkill /pid ${pid} /t /f`, process.cwd());
    const output = `${result.stdout}\n${result.stderr}`;
    if (
      result.exitCode !== 0 &&
      !/no running instance|not found|cannot find the process/i.test(output)
    ) {
      throw new Error(output.trim() || `Failed to stop preview process ${pid}.`);
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const handleExit = () => {
      clearTimeout(forceKillTimer);
      resolve();
    };

    const forceKillTimer = setTimeout(() => {
      child.off("exit", handleExit);
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore best-effort cleanup failures during shutdown.
      }
      resolve();
    }, 1500);

    child.once("exit", handleExit);

    try {
      const killed = child.kill("SIGTERM");
      if (!killed) {
        clearTimeout(forceKillTimer);
        child.off("exit", handleExit);
        resolve();
      }
    } catch {
      clearTimeout(forceKillTimer);
      child.off("exit", handleExit);
      resolve();
    }
  });
}

export async function launchCommandInTerminal(command: string, cwd: string): Promise<void> {
  const normalizedCwd = path.resolve(cwd);

  if (process.platform === "win32") {
    const powershellCwd = normalizedCwd.replace(/'/g, "''");
    const child = spawn(
      "cmd.exe",
      [
        "/c",
        "start",
        "powershell.exe",
        "-NoExit",
        "-Command",
        `Set-Location -LiteralPath '${powershellCwd}'; ${command}`
      ],
      {
        cwd: normalizedCwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false
      }
    );
    child.unref();
    return;
  }

  if (process.platform === "darwin") {
    const appleScript = [
      "tell application \"Terminal\"",
      `do script "cd ${escapeForPosixShell(normalizedCwd)}; ${escapeForAppleScript(command)}"`,
      "activate",
      "end tell"
    ].join("\n");

    const child = spawn("osascript", ["-e", appleScript], {
      cwd: normalizedCwd,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return;
  }

  const child = spawn(
    "x-terminal-emulator",
    ["-e", `bash -lc 'cd ${escapeForPosixShell(normalizedCwd)}; ${command}; exec bash'`],
    {
      cwd: normalizedCwd,
      detached: true,
      stdio: "ignore"
    }
  );
  child.unref();
}

export async function listFilesRecursive(rootPath: string, basePath = ""): Promise<string[]> {
  const startPath = path.join(rootPath, basePath);
  const entries = await fs.readdir(startPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }
    const relativePath = path.join(basePath, entry.name);
    if (entry.isDirectory()) {
      results.push(`${relativePath}/`);
      const nested = await listFilesRecursive(rootPath, relativePath);
      results.push(...nested);
    } else {
      results.push(relativePath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

export function detectPackageManager(workspacePath: string): PackageManager {
  const joined = (name: string) => path.join(workspacePath, name);
  if (requirementExists(joined("pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (requirementExists(joined("bun.lockb")) || requirementExists(joined("bun.lock"))) {
    return "bun";
  }
  if (requirementExists(joined("yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

function requirementExists(targetPath: string): boolean {
  try {
    return !!(targetPath && fsSync.existsSync(targetPath));
  } catch {
    return false;
  }
}

export function installCommandFor(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    default:
      return "npm install";
  }
}

export function buildCommandFor(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm build";
    case "yarn":
      return "yarn build";
    case "bun":
      return "bun run build";
    default:
      return "npm run build";
  }
}

export function devCommandFor(
  packageManager: PackageManager,
  port: number
): string {
  return packageScriptCommand(packageManager, "dev", ["--host", "127.0.0.1", "--port", String(port)]);
}

export async function previewCommandForWorkspace(
  workspacePath: string,
  packageManager: PackageManager,
  port: number
): Promise<string> {
  const packageJson = await readJsonFile<PackageJsonShape | null>(path.join(workspacePath, "package.json"), null);
  const scripts = packageJson?.scripts ?? {};
  const packageNames = new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {})
  ]);

  const devScript = scripts.dev?.toLowerCase() ?? "";
  if (scripts.dev) {
    if (packageNames.has("next") || /\bnext\b/.test(devScript)) {
      return packageScriptCommand(packageManager, "dev", ["-H", "127.0.0.1", "-p", String(port)]);
    }

    if (usesHostPortFlags(packageNames, devScript)) {
      return packageScriptCommand(packageManager, "dev", ["--host", "127.0.0.1", "--port", String(port)]);
    }

    return packageScriptCommand(packageManager, "dev", []);
  }

  const startScript = scripts.start?.toLowerCase() ?? "";
  if (scripts.start) {
    if (packageNames.has("next") || /\bnext\b/.test(startScript)) {
      return packageScriptCommand(packageManager, "start", ["-H", "127.0.0.1", "-p", String(port)]);
    }

    if (usesHostPortFlags(packageNames, startScript)) {
      return packageScriptCommand(packageManager, "start", ["--host", "127.0.0.1", "--port", String(port)]);
    }

    return packageScriptCommand(packageManager, "start", []);
  }

  if (scripts.preview) {
    return packageScriptCommand(packageManager, "preview", ["--host", "127.0.0.1", "--port", String(port)]);
  }

  throw new Error("This website does not define a dev, start, or preview script in package.json.");
}

function usesHostPortFlags(packageNames: Set<string>, script: string): boolean {
  return (
    packageNames.has("vite") ||
    packageNames.has("astro") ||
    packageNames.has("nuxt") ||
    packageNames.has("@angular/cli") ||
    packageNames.has("@sveltejs/kit") ||
    /\b(vite|astro|nuxt|ng|vite:dev)\b/.test(script)
  );
}

function packageScriptCommand(packageManager: PackageManager, scriptName: string, args: string[]): string {
  switch (packageManager) {
    case "pnpm":
      return ["pnpm", scriptName, ...args].join(" ");
    case "yarn":
      return ["yarn", scriptName, ...args].join(" ");
    case "bun":
      return ["bun", "run", scriptName, ...(args.length > 0 ? ["--", ...args] : [])].join(" ");
    default:
      return ["npm", "run", scriptName, ...(args.length > 0 ? ["--", ...args] : [])].join(" ");
  }
}

export function relativeToWorkspace(workspacePath: string, candidatePath: string): string {
  const resolved = path.resolve(workspacePath, candidatePath);
  const relative = path.relative(workspacePath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("That path escapes the website workspace.");
  }
  return relative;
}

export function resolveWithinWorkspace(workspacePath: string, candidatePath: string): string {
  const relative = relativeToWorkspace(workspacePath, candidatePath);
  return path.join(workspacePath, relative);
}

export async function readTextFileSafe(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf8");
}

export async function writeTextFileSafe(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, "utf8");
}

function escapeForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeForAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
