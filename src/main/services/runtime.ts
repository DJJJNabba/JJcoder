import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import { runCommand, type CommandResult } from "./utils";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type JavaScriptRuntimeSource = "system" | "bundled";
interface RuntimeResolutionOptions {
  allowBundledRuntime?: boolean;
}

interface ResolvedInvocation {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  displayCommand: string;
  source: JavaScriptRuntimeSource;
  shell?: boolean;
}

interface BundledCliPaths {
  rootPath: string | null;
  npmCliPath: string | null;
  vercelCliPath: string | null;
}

let cachedBundledCliPaths: BundledCliPaths | null = null;
let bundledCliPathsPromise: Promise<BundledCliPaths> | null = null;
const bundledToolVerificationCache = new Map<string, Promise<boolean>>();
const BUNDLED_RUNTIME_PROBE_TIMEOUT_MS = 15_000;

export async function commandExists(command: string, cwd = process.cwd()): Promise<boolean> {
  const probe =
    process.platform === "win32"
      ? `where ${command}`
      : `command -v ${quotePosixShell(command)}`;
  const result = await runCommand(probe, cwd);
  return result.exitCode === 0;
}

export async function resolvePackageManagerForWorkspace(
  detectedPackageManager: PackageManager,
  options?: RuntimeResolutionOptions
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

  if (options?.allowBundledRuntime && detectedPackageManager === "npm" && (await hasBundledNpm())) {
    return {
      packageManager: "npm",
      source: "bundled"
    };
  }

  throw new Error(
    detectedPackageManager === "npm"
      ? options?.allowBundledRuntime
        ? "Node.js and npm are not available. Install Node.js or use a JJcoder build that includes the bundled JavaScript runtime."
        : "Node.js and npm are not available. Install Node.js, or enable 'Use packaged npm/runtime fallback' in JJcoder setup."
      : `The workspace expects ${detectedPackageManager}, but it is not installed on this machine. Install ${detectedPackageManager}, or switch the project back to npm${options?.allowBundledRuntime ? " so JJcoder can use its bundled runtime." : "."}`
  );
}

export async function runPackageManagerCommand(
  command: string,
  cwd: string,
  options?: RuntimeResolutionOptions,
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<CommandResult & { source: JavaScriptRuntimeSource }> {
  const invocation = await resolvePackageManagerInvocation(command, options);
  return await runResolvedInvocation(invocation, cwd, onOutput, signal);
}

export async function spawnPackageManagerCommand(
  command: string,
  cwd: string,
  options?: RuntimeResolutionOptions
): Promise<{
  child: ChildProcess;
  displayCommand: string;
  source: JavaScriptRuntimeSource;
}> {
  const invocation = await resolvePackageManagerInvocation(command, options);
  const child = spawn(invocation.file, invocation.args, {
    cwd,
    env: {
      ...process.env,
      CI: "1",
      ...invocation.env
    },
    shell: invocation.shell ?? false,
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
  options?: RuntimeResolutionOptions,
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<CommandResult & { source: JavaScriptRuntimeSource }> {
  const invocation = await resolveVercelInvocation(args, options);
  return await runResolvedInvocation(invocation, cwd, onOutput, signal);
}

export async function hasBundledVercelCli(): Promise<boolean> {
  return Boolean(await ensureBundledToolAvailable("vercel"));
}

export async function createVercelLoginTerminalCommand(options?: RuntimeResolutionOptions): Promise<{
  command: string;
  source: "system" | "bundled" | "browser";
}> {
  if (await commandExists(systemBinaryForCommand("vercel"))) {
    return {
      command: "vercel login",
      source: "system"
    };
  }

  const invocation = options?.allowBundledRuntime ? await resolveBundledNodeInvocation("vercel", ["login"]) : null;
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

async function resolvePackageManagerInvocation(
  command: string,
  options?: RuntimeResolutionOptions
): Promise<ResolvedInvocation> {
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
      source: "system",
      shell: shouldUseShellForSystemCommand(systemBinary)
    };
  }

  if (packageManager !== "npm") {
    throw new Error(
      `JJcoder could not find ${packageManager} on this machine. Bundled fallback currently supports npm only.`
    );
  }

  const bundledInvocation = options?.allowBundledRuntime ? await resolveBundledNodeInvocation("npm", args) : null;
  if (!bundledInvocation) {
    throw new Error(
      options?.allowBundledRuntime
        ? "JJcoder could not find a usable npm runtime. Install Node.js, or rebuild the app with bundled npm included."
        : "JJcoder could not find npm on this machine. Install Node.js, or enable 'Use packaged npm/runtime fallback' in setup."
    );
  }
  return bundledInvocation;
}

async function resolveVercelInvocation(
  args: string[],
  options?: RuntimeResolutionOptions
): Promise<ResolvedInvocation> {
  if (await commandExists(systemBinaryForCommand("vercel"))) {
    return {
      file: systemBinaryForCommand("vercel"),
      args,
      displayCommand: `vercel ${args.join(" ")}`.trim(),
      source: "system",
      shell: shouldUseShellForSystemCommand(systemBinaryForCommand("vercel"))
    };
  }

  const bundledInvocation = options?.allowBundledRuntime ? await resolveBundledNodeInvocation("vercel", args) : null;
  if (!bundledInvocation) {
    throw new Error(
      options?.allowBundledRuntime
        ? "JJcoder could not find the Vercel CLI. Install the Vercel CLI, or use the token-based browser flow in Settings."
        : "JJcoder could not find the Vercel CLI. Install it, enable 'Use packaged npm/runtime fallback', or use the token-based browser flow in Settings."
    );
  }
  return bundledInvocation;
}

async function resolveBundledNodeInvocation(
  tool: "npm" | "vercel",
  args: string[]
): Promise<ResolvedInvocation | null> {
  const scriptPath = await ensureBundledToolAvailable(tool);
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
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<CommandResult & { source: JavaScriptRuntimeSource }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      cwd,
      env: {
        ...process.env,
        CI: "1",
        ...invocation.env
      },
      shell: invocation.shell ?? false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finalizeReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      reject(error);
    };

    const finalizeResolve = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      resolve({
        command: invocation.displayCommand,
        cwd,
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
        source: invocation.source
      });
    };

    const handleAbort = () => {
      try {
        child.kill();
      } catch {
        // Ignore best-effort shutdown failures for aborted commands.
      }

      const reason = signal?.reason;
      finalizeReject(reason instanceof Error ? reason : new Error("Command aborted."));
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

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

    child.on("error", (error) => {
      finalizeReject(error);
    });
    child.on("close", (exitCode) => {
      finalizeResolve(exitCode);
    });
  });
}

async function hasBundledNpm(): Promise<boolean> {
  return Boolean(await ensureBundledToolAvailable("npm"));
}

async function getBundledCliPaths(options?: { forceRefresh?: boolean }): Promise<BundledCliPaths> {
  if (options?.forceRefresh) {
    cachedBundledCliPaths = null;
    bundledCliPathsPromise = null;
    bundledToolVerificationCache.clear();
  } else if (cachedBundledCliPaths) {
    return cachedBundledCliPaths;
  }

  if (!bundledCliPathsPromise) {
    bundledCliPathsPromise = resolveBundledCliPaths(options).finally(() => {
      bundledCliPathsPromise = null;
    });
  }

  cachedBundledCliPaths = await bundledCliPathsPromise;
  return cachedBundledCliPaths;
}

async function resolveBundledCliPaths(options?: { forceRefresh?: boolean }): Promise<BundledCliPaths> {
  if (app.isPackaged) {
    const materializedRoot = await prepareBundledNodeModulesRoot(Boolean(options?.forceRefresh));
    if (materializedRoot) {
      const materializedPaths = await inspectBundledCliRoot(materializedRoot);
      if (materializedPaths.npmCliPath || materializedPaths.vercelCliPath) {
        return materializedPaths;
      }
    }
  }

  for (const root of resolveBundledNodeModuleRoots()) {
    const paths = await inspectBundledCliRoot(root);
    if (paths.npmCliPath || paths.vercelCliPath) {
      return paths;
    }
  }

  return {
    rootPath: null,
    npmCliPath: null,
    vercelCliPath: null
  };
}

async function ensureBundledToolAvailable(tool: "npm" | "vercel"): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cliPaths = await getBundledCliPaths({ forceRefresh: attempt > 0 });
    const scriptPath = tool === "npm" ? cliPaths.npmCliPath : cliPaths.vercelCliPath;
    if (!scriptPath) {
      return null;
    }

    if (await verifyBundledTool(tool, scriptPath)) {
      return scriptPath;
    }
  }

  return null;
}

async function inspectBundledCliRoot(rootPath: string): Promise<BundledCliPaths> {
  const npmCliPath = path.join(rootPath, "npm", "bin", "npm-cli.js");
  const vercelCliPath = path.join(rootPath, "vercel", "dist", "vc.js");

  return {
    rootPath,
    npmCliPath: (await fileExists(npmCliPath)) ? npmCliPath : null,
    vercelCliPath: (await fileExists(vercelCliPath)) ? vercelCliPath : null
  };
}

async function prepareBundledNodeModulesRoot(forceRefresh: boolean): Promise<string | null> {
  const targetRoot = getBundledNodeModulesCacheRoot();
  if (forceRefresh) {
    await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  const cachedPaths = await inspectBundledCliRoot(targetRoot);
  if (cachedPaths.npmCliPath || cachedPaths.vercelCliPath) {
    return targetRoot;
  }

  for (const sourceRoot of resolveBundledRuntimeSourceRoots(targetRoot)) {
    const sourcePaths = await inspectBundledCliRoot(sourceRoot);
    if (!sourcePaths.npmCliPath && !sourcePaths.vercelCliPath) {
      continue;
    }

    try {
      await copyBundledNodeModulesRoot(sourceRoot, targetRoot);
      return targetRoot;
    } catch {
      // Fall through to the next candidate source root.
    }
  }

  return null;
}

function getBundledNodeModulesCacheRoot(): string {
  return path.join(app.getPath("userData"), "bundled-runtime", app.getVersion(), "node_modules");
}

function resolveBundledRuntimeSourceRoots(targetRoot: string): string[] {
  const roots = new Set<string>();
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath;

  roots.add(path.join(appPath, "node_modules"));
  roots.add(path.join(resourcesPath, "app.asar.unpacked", "node_modules"));
  roots.add(path.join(resourcesPath, "node_modules"));
  roots.add(path.join(process.cwd(), "node_modules"));
  roots.delete(targetRoot);

  return [...roots];
}

async function copyBundledNodeModulesRoot(sourceRoot: string, targetRoot: string): Promise<void> {
  const targetDirectory = path.dirname(targetRoot);
  const temporaryRoot = path.join(targetDirectory, `node_modules.tmp-${process.pid}`);

  await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.cp(sourceRoot, temporaryRoot, {
    recursive: true,
    force: true
  });
  await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.rename(temporaryRoot, targetRoot);
}

async function verifyBundledTool(tool: "npm" | "vercel", scriptPath: string): Promise<boolean> {
  const cacheKey = `${tool}:${scriptPath}`;
  const cached = bundledToolVerificationCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const verification = probeBundledTool(scriptPath).catch(() => false);
  bundledToolVerificationCache.set(cacheKey, verification);
  const verified = await verification;
  if (!verified) {
    bundledToolVerificationCache.delete(cacheKey);
  }
  return verified;
}

async function probeBundledTool(scriptPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const child = spawn(process.execPath, [scriptPath, "--version"], {
      cwd: app.getPath("userData"),
      env: {
        ...process.env,
        CI: "1",
        ELECTRON_RUN_AS_NODE: "1"
      },
      shell: false,
      windowsHide: true
    });

    const finish = (success: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(success);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore probe shutdown failures.
      }
      finish(false);
    }, BUNDLED_RUNTIME_PROBE_TIMEOUT_MS);

    child.once("error", () => finish(false));
    child.once("close", (exitCode) => finish(exitCode === 0));
  });
}

function resolveBundledNodeModuleRoots(): string[] {
  const roots = new Set<string>();
  const appPath = app.isPackaged ? app.getAppPath() : process.cwd();
  const resourcesPath = process.resourcesPath;

  roots.add(path.join(appPath, "node_modules"));

  if (app.isPackaged) {
    roots.add(path.join(resourcesPath, "app.asar.unpacked", "node_modules"));
    roots.add(path.join(resourcesPath, "node_modules"));
  }

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

function shouldUseShellForSystemCommand(file: string): boolean {
  return process.platform === "win32" && (/\.(cmd|bat)$/i.test(file) || !path.extname(file));
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
