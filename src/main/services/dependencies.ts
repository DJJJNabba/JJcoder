import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runPackageManagerCommand, type JavaScriptRuntimeSource, type PackageManager } from "./runtime";
import { fileExists, installCommandFor, readJsonFile } from "./utils";

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface WorkspaceInstallState {
  packageManager: PackageManager;
  manifestHash: string;
  installedAt: string;
}

export interface EnsureWorkspaceDependenciesResult {
  performedInstall: boolean;
  reason: string;
  source: JavaScriptRuntimeSource;
}

const installLocks = new Map<string, Promise<EnsureWorkspaceDependenciesResult>>();

export async function ensureWorkspaceDependencies(options: {
  workspacePath: string;
  packageManager: PackageManager;
  allowBundledRuntime?: boolean;
  onOutput?: (chunk: string) => void;
}): Promise<EnsureWorkspaceDependenciesResult> {
  const key = `${path.resolve(options.workspacePath)}::${options.packageManager}`;
  const existing = installLocks.get(key);
  if (existing) {
    return await existing;
  }

  const task = ensureWorkspaceDependenciesInternal(options).finally(() => {
    if (installLocks.get(key) === task) {
      installLocks.delete(key);
    }
  });
  installLocks.set(key, task);
  return await task;
}

async function ensureWorkspaceDependenciesInternal(options: {
  workspacePath: string;
  packageManager: PackageManager;
  allowBundledRuntime?: boolean;
  onOutput?: (chunk: string) => void;
}): Promise<EnsureWorkspaceDependenciesResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const packageJsonPath = path.join(workspacePath, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    throw new Error("This website does not have a package.json yet.");
  }

  const manifestHash = await computeWorkspaceManifestHash(workspacePath, options.packageManager);
  const installStatePath = path.join(workspacePath, "node_modules", ".jjcoder-install-state.json");
  const installState = await readJsonFile<WorkspaceInstallState | null>(installStatePath, null);
  const packageJson = await readJsonFile<PackageJsonShape | null>(packageJsonPath, null);
  const reason = await getInstallReason({
    workspacePath,
    packageManager: options.packageManager,
    manifestHash,
    installState,
    packageJson
  });

  if (!reason) {
    return {
      performedInstall: false,
      reason: "Dependencies already match the current workspace manifest.",
      source: "system"
    };
  }

  const result = await runPackageManagerCommand(
    installCommandFor(options.packageManager),
    workspacePath,
    { allowBundledRuntime: options.allowBundledRuntime },
    options.onOutput
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to install dependencies.");
  }

  await fs.mkdir(path.dirname(installStatePath), { recursive: true });
  await fs.writeFile(
    installStatePath,
    `${JSON.stringify(
      {
        packageManager: options.packageManager,
        manifestHash,
        installedAt: new Date().toISOString()
      } satisfies WorkspaceInstallState,
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    performedInstall: true,
    reason,
    source: result.source
  };
}

async function getInstallReason(options: {
  workspacePath: string;
  packageManager: PackageManager;
  manifestHash: string;
  installState: WorkspaceInstallState | null;
  packageJson: PackageJsonShape | null;
}): Promise<string | null> {
  const nodeModulesPath = path.join(options.workspacePath, "node_modules");
  if (!(await fileExists(nodeModulesPath))) {
    return "node_modules is missing.";
  }

  if (!(await directoryHasEntries(nodeModulesPath))) {
    return "node_modules exists but is empty.";
  }

  const missingPackages = await findMissingTopLevelPackages(nodeModulesPath, options.packageJson);
  if (missingPackages.length > 0) {
    const preview = missingPackages.slice(0, 3).join(", ");
    const suffix = missingPackages.length > 3 ? ", ..." : "";
    return `Top-level dependencies are missing from node_modules (${preview}${suffix}).`;
  }

  if (!options.installState) {
    return "No JJcoder install state was recorded for this workspace.";
  }

  if (options.installState.packageManager !== options.packageManager) {
    return `The workspace switched from ${options.installState.packageManager} to ${options.packageManager}.`;
  }

  if (options.installState.manifestHash !== options.manifestHash) {
    return "package.json or the active lockfile changed since the last successful install.";
  }

  return null;
}

async function computeWorkspaceManifestHash(workspacePath: string, packageManager: PackageManager): Promise<string> {
  const hash = crypto.createHash("sha256");
  const manifestPaths = getWorkspaceManifestPaths(workspacePath, packageManager);

  for (const manifestPath of manifestPaths) {
    if (!(await fileExists(manifestPath))) {
      continue;
    }
    const contents = await fs.readFile(manifestPath);
    hash.update(manifestPath);
    hash.update("\n");
    hash.update(contents);
    hash.update("\n");
  }

  return hash.digest("hex");
}

function getWorkspaceManifestPaths(workspacePath: string, packageManager: PackageManager): string[] {
  const joined = (fileName: string) => path.join(workspacePath, fileName);
  const common = [joined("package.json"), joined(".npmrc")];
  switch (packageManager) {
    case "pnpm":
      return [...common, joined("pnpm-lock.yaml"), joined("pnpm-workspace.yaml")];
    case "yarn":
      return [...common, joined("yarn.lock"), joined(".yarnrc"), joined(".yarnrc.yml")];
    case "bun":
      return [...common, joined("bun.lock"), joined("bun.lockb")];
    default:
      return [...common, joined("package-lock.json"), joined("npm-shrinkwrap.json")];
  }
}

async function directoryHasEntries(directoryPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directoryPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function findMissingTopLevelPackages(
  nodeModulesPath: string,
  packageJson: PackageJsonShape | null
): Promise<string[]> {
  if (!packageJson) {
    return [];
  }

  const declaredPackages = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {})
  ]);

  const missing: string[] = [];
  for (const packageName of declaredPackages) {
    const packagePath = path.join(nodeModulesPath, ...packageName.split("/"));
    if (!(await fileExists(packagePath))) {
      missing.push(packageName);
    }
  }

  return missing;
}
