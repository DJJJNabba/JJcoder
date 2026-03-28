import { shell } from "electron";
import type { AuthSource, AuthState, ProviderLoginKind } from "@shared/types";
import type { CredentialVault } from "./credentials";
import { launchCommandInTerminal, runCommand } from "./utils";

function readEnvValue(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

async function commandSucceeds(command: string): Promise<boolean> {
  const result = await runCommand(command, process.cwd());
  return result.exitCode === 0;
}

async function isCommandAvailable(command: string): Promise<boolean> {
  return await commandSucceeds(command);
}

async function resolveGitHubSource(vault: CredentialVault): Promise<{
  source: AuthSource;
  cliInstalled: boolean;
}> {
  const stored = await vault.getSecret("github");
  if (stored) {
    return {
      source: "vault",
      cliInstalled: await commandSucceeds("gh --version")
    };
  }

  if (readEnvValue(["GITHUB_TOKEN", "GH_TOKEN"])) {
    return {
      source: "env",
      cliInstalled: await commandSucceeds("gh --version")
    };
  }

  const cliInstalled = await commandSucceeds("gh --version");
  if (!cliInstalled) {
    return {
      source: null,
      cliInstalled: false
    };
  }

  return {
    source: (await commandSucceeds("gh auth status")) ? "github-cli" : null,
    cliInstalled: true
  };
}

async function resolveVercelSource(
  vault: CredentialVault,
  options?: { deep?: boolean }
): Promise<{
  source: AuthSource;
  cliInstalled: boolean;
}> {
  const stored = await vault.getSecret("vercel");
  if (stored) {
    return {
      source: "vault",
      cliInstalled: await commandSucceeds("vercel --version")
    };
  }

  if (readEnvValue(["VERCEL_TOKEN"])) {
    return {
      source: "env",
      cliInstalled: await commandSucceeds("vercel --version")
    };
  }

  const cliInstalled = await commandSucceeds("vercel --version");
  if (cliInstalled) {
    return {
      source: (await commandSucceeds("vercel whoami")) ? "vercel-cli" : null,
      cliInstalled: true
    };
  }

  if (!options?.deep) {
    return {
      source: null,
      cliInstalled: false
    };
  }

  return {
    source: (await commandSucceeds("npx --yes vercel whoami")) ? "vercel-cli" : null,
    cliInstalled: false
  };
}

export async function resolveAuthState(
  vault: CredentialVault,
  options?: { deepVercelCheck?: boolean }
): Promise<AuthState> {
  const presence = await vault.getPresence();
  const github = await resolveGitHubSource(vault);
  const vercel = await resolveVercelSource(vault, { deep: options?.deepVercelCheck });
  const openRouterSource: AuthSource = presence.openrouter
    ? "vault"
    : readEnvValue(["OPENROUTER_API_KEY"])
      ? "env"
      : null;

  return {
    openRouterConfigured: Boolean(openRouterSource),
    githubConfigured: Boolean(github.source),
    vercelConfigured: Boolean(vercel.source),
    encryptionAvailable: presence.encryptionAvailable,
    openRouterSource,
    githubSource: github.source,
    vercelSource: vercel.source,
    githubCliInstalled: github.cliInstalled,
    vercelCliInstalled: vercel.cliInstalled
  };
}

export async function getOpenRouterApiKey(vault: CredentialVault): Promise<string | null> {
  return (await vault.getSecret("openrouter")) ?? readEnvValue(["OPENROUTER_API_KEY"]);
}

export async function getGitHubToken(vault: CredentialVault): Promise<string | null> {
  return (await vault.getSecret("github")) ?? readEnvValue(["GITHUB_TOKEN", "GH_TOKEN"]);
}

export async function getVercelToken(vault: CredentialVault): Promise<string | null> {
  return (await vault.getSecret("vercel")) ?? readEnvValue(["VERCEL_TOKEN"]);
}

export async function launchProviderLogin(provider: ProviderLoginKind): Promise<void> {
  const cwd = process.cwd();
  if (provider === "github") {
    if (await isCommandAvailable("gh --version")) {
      await launchCommandInTerminal("gh auth login --web", cwd);
      return;
    }

    await shell.openExternal("https://github.com/settings/tokens");
    return;
  }

  if (await isCommandAvailable("vercel --version")) {
    await launchCommandInTerminal("vercel login", cwd);
    return;
  }

  await shell.openExternal("https://vercel.com/account/tokens");
}
