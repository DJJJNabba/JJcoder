import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import { runCommand, type CommandResult } from "./utils";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type JavaScriptRuntimeSource = "system" | "bundled";

interface ResolvedInvocation {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  displayCommand: string;
  source: JavaScriptRuntimeSource;
}

interface BundledCliPaths {
  npmCliPath: string | null;
  vercelCliPath: string | null;
}

let cachedBundledCliPaths: BundledCliPaths | null = null;

export async function commandExists(command: string, cwd = process.cwd()): Promise<boolean> {
  const probe =
    process.platform === "win32"
      ? `where ${command}`
      : `command -v ${quotePosixShell(command)}`;
  const result = await runCommand(probe, cwd);
  return result.exitCode === 0;
}

export async function resolvePackageManagerForWorkspace(
  detectedPackageManager: PackageManager
): Promise<{
  packageManager: PackageManager;
  source: JavaScriptRuntimeSource;
}> {
  if (await commandExists(systemBinaryForPackageManager(detectedPackageManager))) {
    return {
      packageManager: detectedPackageManager,
      source: "system"
    };
  }

  if (detectedPackageManager === "npm" && (await hasBundledNpm())) {
    return {
      packageManager: "npm",
      source: "bundled"
    };
  }

  throw new Error(
    detectedPackageManager === "npm"
      ? "Node.js and npm are not available. Install Node.js or use a JJcoder build that includes the bundled JavaScript runtime."
      : `The workspace expects ${detectedPackageManager}, but it is not installed on this machine. Install ${detectedPackageManager}, or switch the project back to npm so JJcoder can use its bundled runtime.`
  );
}

export async function runPackageManagerCommand(
  command: string,
  cwd: string,
  onOutput?: (chunk: string) => void
): Promise<CommandResult & { source: JavaScriptRuntimeSource }> {
  const invocation = await resolvePackageManagerInvocation(command);
  return await runResolvedInvocation(invocation, cwd, onOutput);
}

export async function spawnPackageManagerCommand(
  command: string,
  cwd: string
): Promise<{
  child: ChildProcess;
  displayCommand: string;
  source: JavaScriptRuntimeSource;
}> {
  const invocation = await resolvePackageManagerInvocation(command);
  const child = spawn(invocation.file, invocation.args, {
    cwd,
    env: {
      ...process.env,
      CI: "1",
      ...invocation.env
    },
    shell: false,
    windowsHide: true
  });

  return {
    child,
    displayCommand: invocation.displayCommand,
    source: invocation.source
  };
}

export async function runVercelCliCommand(
  args: string[],
  cwd: string,
  onOutput?: (chunk: string) => void
): Promise<CommandResult & { source: JavaScriptRuntimeSource }> {
  const invocation = await resolveVercelInvocation(args);
  return await runResolvedInvocation(invocation, cwd, onOutput);
}

export async function hasBundledVercelCli(): Promise<boolean> {
  const paths = await getBundledCliPaths();
  return Boolean(paths.vercelCliPath && paths.npmCliPath);
}

export async function createVercelLoginTerminalCommand(): Promise<{
  command: string;
  source: "system" | "bundled" | "browser";
}> {
  if (await commandExists(systemBinaryForCommand("vercel"))) {
    return {
      command: "vercel login",
      source: "system"
    };
  }

  const invocation = await resolveBundledNodeInvocation("vercel", ["login"]);
  if (invocation) {
    return {
      command: toTerminalCommand(invocation),
      source: "bundled"
    };
  }

  return {
    command: "",
    source: "browser"
  };
}

async function resolvePackageManagerInvocation(command: string): Promise<ResolvedInvocation> {
  const parts = tokenizeCommand(command);
  const packageManager = normalizePackageManager(parts[0] ?? "");
  if (!packageManager) {
    throw new Error("Unsupported package manager command.");
  }

  const args = parts.slice(1);
  const systemBinary = systemBinaryForPackageManager(packageManager);
  if (await commandExists(systemBinary)) {
    return {
      file: systemBinary,
      args,
      displayCommand: `${packageManager} ${args.join(" ")}`.trim(),
      source: "system"
    };
  }

  if (packageManager !== "npm") {
    throw new Error(
      `JJcoder could not find ${packageManager} on this machine. Bundled fallback currently supports npm only.`
    );
  }

  const bundledInvocation = await resolveBundledNodeInvocation("npm", args);
  if (!bundledInvocation) {
    throw new Error(
      "JJcoder could not find a usable npm runtime. Install Node.js, or rebuild the app with bundled npm included."
    );
  }
  return bundledInvocation;
}

async function resolveVercelInvocation(args: string[]): Promise<ResolvedInvocation> {
  if (await commandExists(systemBinaryForCommand("vercel"))) {
    return {
      file: systemBinaryForCommand("vercel"),
      args,
      displayCommand: `vercel ${args.join(" ")}`.trim(),
      source: "system"
    };
  }

  const bundledInvocation = await resolveBundledNodeInvocation("vercel", args);
  if (!bundledInvocation) {
    throw new Error(
      "JJcoder could not find the Vercel CLI. Install the Vercel CLI, or use the token-based browser flow in Settings."
    );
  }
  return bundledInvocation;
}

async function resolveBundledNodeInvocation(
  tool: "npm" | "vercel",
  args: string[]
): Promise<ResolvedInvocation | null> {
  const cliPaths = await getBundledCliPaths();
  const scriptPath = tool === "npm" ? cliPaths.npmCliPath : cliPaths.vercelCliPath;
  if (!scriptPath) {
    return null;
  }

  return {
    file: process.execPath,
    args: [scriptPath, ...args],
    env: {
      ELECTRON_RUN_AS_NODE: "1"
    },
    displayCommand: `${tool} ${args.join(" ")}`.trim(),
    source: "bundled"
  };
}

async function runResolvedInvocation(
  invocation: ResolvedInvocation,
  cwd: string,
  onOutput?: (chunk: string) => void
): Promise<CommandResult & { source: JavaScriptRuntimeSource }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      cwd,
      env: {
        ...process.env,
        CI: "1",
        ...invocation.env
      },
      shell: false,
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
        command: invocation.displayCommand,
        cwd,
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
        source: invocation.source
      });
    });
  });
}

async function hasBundledNpm(): Promise<boolean> {
  const paths = await getBundledCliPaths();
  return Boolean(paths.npmCliPath);
}

async function getBundledCliPaths(): Promise<BundledCliPaths> {
  if (cachedBundledCliPaths) {
    return cachedBundledCliPaths;
  }

  const candidateRoots = resolveBundledNodeModuleRoots();
  let npmCliPath: string | null = null;
  let vercelCliPath: string | null = null;

  for (const root of candidateRoots) {
    if (!npmCliPath) {
      const npmCandidate = path.join(root, "npm", "bin", "npm-cli.js");
      if (await fileExists(npmCandidate)) {
        npmCliPath = npmCandidate;
      }
    }

    if (!vercelCliPath) {
      const vercelCandidate = path.join(root, "vercel", "dist", "vc.js");
      if (await fileExists(vercelCandidate)) {
        vercelCliPath = vercelCandidate;
      }
    }

    if (npmCliPath && vercelCliPath) {
      break;
    }
  }

  cachedBundledCliPaths = {
    npmCliPath,
    vercelCliPath
  };
  return cachedBundledCliPaths;
}

function resolveBundledNodeModuleRoots(): string[] {
  const roots = new Set<string>();
  const appPath = app.isPackaged ? app.getAppPath() : process.cwd();
  const resourcesPath = process.resourcesPath;

  if (app.isPackaged) {
    roots.add(path.join(resourcesPath, "app.asar.unpacked", "node_modules"));
    roots.add(path.join(resourcesPath, "node_modules"));
  }

  roots.add(path.join(appPath, "node_modules"));
  roots.add(path.join(process.cwd(), "node_modules"));

  return [...roots];
}

function normalizePackageManager(value: string): PackageManager | null {
  switch (value.toLowerCase()) {
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      return value.toLowerCase() as PackageManager;
    default:
      return null;
  }
}

function systemBinaryForPackageManager(packageManager: PackageManager): string {
  if (packageManager === "npm") {
    return systemBinaryForCommand("npm");
  }
  return systemBinaryForCommand(packageManager);
}

function systemBinaryForCommand(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function toTerminalCommand(invocation: ResolvedInvocation): string {
  if (process.platform !== "win32") {
    const envPrefix = invocation.env?.ELECTRON_RUN_AS_NODE ? "ELECTRON_RUN_AS_NODE=1 " : "";
    const commandWithArgs = [quotePosixShell(invocation.file), ...invocation.args.map(quotePosixShell)].join(" ");
    return `${envPrefix}${commandWithArgs}`;
  }

  const envPrefix = invocation.env?.ELECTRON_RUN_AS_NODE
    ? `$env:ELECTRON_RUN_AS_NODE=${quotePowerShell(invocation.env.ELECTRON_RUN_AS_NODE)}; `
    : "";
  const commandWithArgs = [quotePowerShell(invocation.file), ...invocation.args.map(quotePowerShell)]
    .map((value, index) => (index === 0 ? `& ${value}` : value))
    .join(" ");
  return `${envPrefix}${commandWithArgs}`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
