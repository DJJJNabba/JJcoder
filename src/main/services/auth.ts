import { shell } from "electron";
import type { AuthSource, AuthState, ProviderLoginKind } from "@shared/types";
import type { CredentialVault } from "./credentials";
import { launchCommandInTerminal, runCommand } from "./utils";
import { commandExists, createVercelLoginTerminalCommand, hasBundledVercelCli, runVercelCliCommand } from "./runtime";

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

async function resolveGitHubSource(vault: CredentialVault): Promise<{
  source: AuthSource;
  cliInstalled: boolean;
}> {
  const stored = await vault.getSecret("github");
  const cliInstalled = await commandExists("gh");
  if (stored) {
    return {
      source: "vault",
      cliInstalled
    };
  }

  if (readEnvValue(["GITHUB_TOKEN", "GH_TOKEN"])) {
    return {
      source: "env",
      cliInstalled
    };
  }

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
  options?: { deep?: boolean; allowBundledRuntime?: boolean }
): Promise<{
  source: AuthSource;
  cliInstalled: boolean;
}> {
  const stored = await vault.getSecret("vercel");
  const systemCliInstalled = await commandExists("vercel");
  const bundledCliInstalled = options?.allowBundledRuntime ? await hasBundledVercelCli() : false;
  const cliInstalled = systemCliInstalled || bundledCliInstalled;
  if (stored) {
    return {
      source: "vault",
      cliInstalled
    };
  }

  if (readEnvValue(["VERCEL_TOKEN"])) {
    return {
      source: "env",
      cliInstalled
    };
  }

  if (systemCliInstalled) {
    return {
      source: (await commandSucceeds("vercel whoami")) ? "vercel-cli" : null,
      cliInstalled: true
    };
  }

  if (!options?.deep) {
    return {
      source: null,
      cliInstalled
    };
  }

  if (bundledCliInstalled) {
    const result = await runVercelCliCommand(["whoami"], process.cwd(), {
      allowBundledRuntime: options?.allowBundledRuntime
    });
    return {
      source: result.exitCode === 0 ? "vercel-cli" : null,
      cliInstalled: true
    };
  }

  return {
    source: null,
    cliInstalled: false
  };
}

async function canLaunchVercelLoginTerminal(
  source: "system" | "bundled" | "browser",
  options?: { allowBundledRuntime?: boolean }
): Promise<boolean> {
  if (source === "browser") {
    return false;
  }

  if (source === "system") {
    return await commandSucceeds("vercel --version");
  }

  try {
    const result = await runVercelCliCommand(["--version"], process.cwd(), {
      allowBundledRuntime: options?.allowBundledRuntime
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function resolveAuthState(
  vault: CredentialVault,
  options?: { deepVercelCheck?: boolean; allowBundledRuntime?: boolean }
): Promise<AuthState> {
  const presence = await vault.getPresence();
  const github = await resolveGitHubSource(vault);
  const vercel = await resolveVercelSource(vault, {
    deep: options?.deepVercelCheck,
    allowBundledRuntime: options?.allowBundledRuntime
  });
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

export async function launchProviderLogin(
  provider: ProviderLoginKind,
  options?: { allowBundledRuntime?: boolean }
): Promise<void> {
  const cwd = process.cwd();
  if (provider === "github") {
    if (await commandExists("gh")) {
      await launchCommandInTerminal("gh auth login --web", cwd);
      return;
    }

    await shell.openExternal("https://github.com/settings/tokens");
    return;
  }

  const loginCommand = await createVercelLoginTerminalCommand({
    allowBundledRuntime: options?.allowBundledRuntime
  });
  if (await canLaunchVercelLoginTerminal(loginCommand.source, options)) {
    await launchCommandInTerminal(loginCommand.command, cwd);
    return;
  }

  await shell.openExternal("https://vercel.com/account/tokens");
}
