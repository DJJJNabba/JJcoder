import fs from "node:fs/promises";
import path from "node:path";
import { Vercel } from "@vercel/sdk";
import type { DeploymentTarget, VercelState, Website } from "@shared/types";
import { buildCommandFor, detectPackageManager, fileExists, installCommandFor, readJsonFile, runCommand, runCommandOrThrow, sanitizeProjectName } from "./utils";

async function collectDistFiles(rootPath: string, basePath = ""): Promise<Array<{ file: string; data: string; encoding: "utf-8" | "base64" }>> {
  const targetPath = path.join(rootPath, basePath);
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const results: Array<{ file: string; data: string; encoding: "utf-8" | "base64" }> = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(basePath.replaceAll("\\", "/"), entry.name);
    const absolutePath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectDistFiles(rootPath, relativePath)));
      continue;
    }
    const buffer = await fs.readFile(absolutePath);
    const isText = /\.(html|css|js|json|txt|svg|xml|webmanifest|map)$/i.test(entry.name);
    results.push({
      file: relativePath,
      data: isText ? buffer.toString("utf8") : buffer.toString("base64"),
      encoding: isText ? "utf-8" : "base64"
    });
  }

  return results;
}

export async function deployWebsiteToVercel(options: {
  website: Website;
  token: string;
  teamId?: string;
  teamSlug?: string;
  target: DeploymentTarget;
}): Promise<VercelState> {
  const packageManager = detectPackageManager(options.website.workspacePath);
  const nodeModulesPath = path.join(options.website.workspacePath, "node_modules");
  if (!(await fileExists(nodeModulesPath))) {
    await runCommandOrThrow(installCommandFor(packageManager), options.website.workspacePath);
  }
  await runCommandOrThrow(buildCommandFor(packageManager), options.website.workspacePath);

  const distPath = path.join(options.website.workspacePath, "dist");
  if (!(await fileExists(distPath))) {
    throw new Error("No dist folder was produced after the build step.");
  }

  const projectName =
    options.website.vercel.projectName ??
    (sanitizeProjectName(options.website.name) || `jjcoder-${options.website.id.slice(0, 6)}`);

  const vercel = new Vercel({
    bearerToken: options.token
  });

  if (!options.website.vercel.projectId) {
    await vercel.projects.createProject({
      teamId: options.teamId || undefined,
      slug: options.teamSlug || undefined,
      requestBody: {
        name: projectName
      }
    });
  }

  const files = await collectDistFiles(distPath);
  const deployment = await vercel.deployments.createDeployment({
    teamId: options.teamId || undefined,
    slug: options.teamSlug || undefined,
    requestBody: {
      name: projectName,
      project: projectName,
      target: options.target,
      files,
      projectSettings: {
        framework: "vite",
        buildCommand: buildCommandFor(packageManager),
        installCommand: installCommandFor(packageManager),
        outputDirectory: "dist"
      }
    }
  });

  const deploymentUrl =
    "url" in deployment && typeof deployment.url === "string"
      ? `https://${deployment.url}`
      : null;
  const deploymentId =
    "id" in deployment && typeof deployment.id === "string" ? deployment.id : null;
  const projectId =
    "projectId" in deployment && typeof deployment.projectId === "string"
      ? deployment.projectId
      : options.website.vercel.projectId;

  return {
    projectName,
    projectId: projectId ?? null,
    dashboardUrl: projectName ? `https://vercel.com/dashboard/${projectName}` : null,
    deploymentId,
    deploymentUrl,
    target: options.target,
    lastDeployedAt: new Date().toISOString()
  };
}

interface VercelProjectMetadata {
  projectId?: string;
  orgId?: string;
}

export async function deployWebsiteToVercelWithCli(options: {
  website: Website;
  target: DeploymentTarget;
}): Promise<VercelState> {
  const packageManager = detectPackageManager(options.website.workspacePath);
  const nodeModulesPath = path.join(options.website.workspacePath, "node_modules");
  if (!(await fileExists(nodeModulesPath))) {
    await runCommandOrThrow(installCommandFor(packageManager), options.website.workspacePath);
  }

  const cliBinary = (await runCommand("vercel --version", options.website.workspacePath)).exitCode === 0
    ? "vercel"
    : "npx --yes vercel";
  const deployCommand = `${cliBinary} deploy ${options.target === "production" ? "--prod " : ""}--yes`;
  const result = await runCommandOrThrow(deployCommand, options.website.workspacePath);
  const deploymentUrl = extractDeploymentUrl(result.stdout) ?? extractDeploymentUrl(result.stderr);
  const projectMetadata = await readJsonFile<VercelProjectMetadata | null>(
    path.join(options.website.workspacePath, ".vercel", "project.json"),
    null
  );
  const projectName =
    options.website.vercel.projectName ??
    sanitizeProjectName(options.website.name) ??
    sanitizeProjectName(path.basename(options.website.workspacePath));

  return {
    projectName,
    projectId: projectMetadata?.projectId ?? options.website.vercel.projectId,
    dashboardUrl: null,
    deploymentId: null,
    deploymentUrl,
    target: options.target,
    lastDeployedAt: new Date().toISOString()
  };
}

function extractDeploymentUrl(output: string): string | null {
  const match = output.match(/https:\/\/[^\s]+/i);
  return match?.[0] ?? null;
}
