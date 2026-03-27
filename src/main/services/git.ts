import fs from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import type { GitHubState, Website } from "@shared/types";
import { runCommand, runCommandOrThrow, sanitizeProjectName } from "./utils";

function buildCleanRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}

function buildPushRepoUrl(owner: string, repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

async function getGitValue(command: string, cwd: string): Promise<string | null> {
  const result = await runCommand(command, cwd);
  if (result.exitCode !== 0) {
    return null;
  }
  const text = result.stdout.trim();
  return text.length > 0 ? text : null;
}

export async function readGitState(website: Website): Promise<GitHubState> {
  if (!fs.existsSync(path.join(website.workspacePath, ".git"))) {
    return {
      repoName: website.github.repoName,
      repoOwner: website.github.repoOwner,
      repoUrl: website.github.repoUrl,
      remoteUrl: null,
      branch: null,
      dirtyFiles: 0,
      lastCommit: null
    };
  }

  const status = await runCommand("git status --short", website.workspacePath);
  const branch = await getGitValue("git rev-parse --abbrev-ref HEAD", website.workspacePath);
  const lastCommit = await getGitValue("git rev-parse --short HEAD", website.workspacePath);
  const remoteUrl = await getGitValue("git remote get-url origin", website.workspacePath);

  return {
    repoName: website.github.repoName,
    repoOwner: website.github.repoOwner,
    repoUrl: website.github.repoUrl,
    remoteUrl,
    branch,
    dirtyFiles: status.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length,
    lastCommit
  };
}

export async function initGitRepository(workspacePath: string): Promise<void> {
  const hasGit = fs.existsSync(path.join(workspacePath, ".git"));
  if (!hasGit) {
    await runCommandOrThrow("git init", workspacePath);
    await runCommandOrThrow("git branch -M main", workspacePath);
  }
}

export async function publishGitHubRepository(options: {
  website: Website;
  repoName: string;
  githubToken: string;
  owner?: string;
}): Promise<GitHubState> {
  await initGitRepository(options.website.workspacePath);
  const octokit = new Octokit({
    auth: options.githubToken
  });
  const viewer = await octokit.users.getAuthenticated();
  const owner = options.owner?.trim() || viewer.data.login;
  const repoName = sanitizeProjectName(options.repoName) || sanitizeProjectName(options.website.name);

  if (owner === viewer.data.login) {
    await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      private: false,
      auto_init: false
    });
  } else {
    await octokit.repos.createInOrg({
      org: owner,
      name: repoName,
      private: false
    });
  }

  const cleanRepoUrl = buildCleanRepoUrl(owner, repoName);
  const remoteResult = await runCommand("git remote get-url origin", options.website.workspacePath);
  if (remoteResult.exitCode === 0) {
    await runCommandOrThrow(
      `git remote set-url origin ${cleanRepoUrl}`,
      options.website.workspacePath
    );
  } else {
    await runCommandOrThrow(
      `git remote add origin ${cleanRepoUrl}`,
      options.website.workspacePath
    );
  }

  await runCommandOrThrow("git add .", options.website.workspacePath);
  await runCommand("git commit -m \"Initial JJcoder website publish\"", options.website.workspacePath);
  await runCommandOrThrow(
    `git push ${buildPushRepoUrl(owner, repoName, options.githubToken)} main`,
    options.website.workspacePath
  );

  return {
    repoName,
    repoOwner: owner,
    repoUrl: `https://github.com/${owner}/${repoName}`,
    remoteUrl: cleanRepoUrl,
    branch: "main",
    dirtyFiles: 0,
    lastCommit: await getGitValue("git rev-parse --short HEAD", options.website.workspacePath)
  };
}

export async function publishGitHubRepositoryWithCli(options: {
  website: Website;
  repoName: string;
  owner?: string;
}): Promise<GitHubState> {
  await initGitRepository(options.website.workspacePath);
  const repoName = sanitizeProjectName(options.repoName) || sanitizeProjectName(options.website.name);
  const ownerPrefix = options.owner?.trim() ? `${options.owner.trim()}/` : "";
  const fullRepoName = `${ownerPrefix}${repoName}`;

  await runCommandOrThrow("git add .", options.website.workspacePath);
  await runCommand("git commit -m \"Initial JJcoder website publish\"", options.website.workspacePath);
  await runCommandOrThrow(
    `gh repo create ${fullRepoName} --public --source . --remote origin --push`,
    options.website.workspacePath
  );

  const remoteUrl = await getGitValue("git remote get-url origin", options.website.workspacePath);
  const parsedRemote = remoteUrl?.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i);
  const repoOwner = parsedRemote?.groups?.owner ?? options.owner?.trim() ?? null;
  const cleanRepoName = parsedRemote?.groups?.repo ?? repoName;

  return {
    repoName: cleanRepoName,
    repoOwner,
    repoUrl: repoOwner ? `https://github.com/${repoOwner}/${cleanRepoName}` : null,
    remoteUrl,
    branch: await getGitValue("git rev-parse --abbrev-ref HEAD", options.website.workspacePath),
    dirtyFiles: 0,
    lastCommit: await getGitValue("git rev-parse --short HEAD", options.website.workspacePath)
  };
}
