import path from "node:path";
import { safeStorage } from "electron";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils";

type SecretKind = "openrouter" | "github" | "vercel";

interface SecretsFile {
  encrypted: boolean;
  values: Partial<Record<SecretKind, string>>;
}

export class CredentialVault {
  private readonly secretsPath: string;

  constructor(baseDirectory: string) {
    this.secretsPath = path.join(baseDirectory, "secrets.json");
  }

  async setSecret(kind: SecretKind, value: string): Promise<void> {
    const current = await this.readFile();
    const encrypted = safeStorage.isEncryptionAvailable();
    const next: SecretsFile = {
      encrypted,
      values: {
        ...current.values,
        [kind]: encrypted
          ? safeStorage.encryptString(value).toString("base64")
          : Buffer.from(value, "utf8").toString("base64")
      }
    };
    await ensureDir(path.dirname(this.secretsPath));
    await writeJsonFile(this.secretsPath, next);
  }

  async clearSecret(kind: SecretKind): Promise<void> {
    const current = await this.readFile();
    const nextValues = { ...current.values };
    delete nextValues[kind];
    await writeJsonFile(this.secretsPath, {
      encrypted: current.encrypted,
      values: nextValues
    });
  }

  async getSecret(kind: SecretKind): Promise<string | null> {
    const current = await this.readFile();
    const value = current.values[kind];
    if (!value) {
      return null;
    }

    const buffer = Buffer.from(value, "base64");
    if (current.encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buffer);
      } catch {
        return null;
      }
    }

    return buffer.toString("utf8");
  }

  async getPresence() {
    const current = await this.readFile();
    return {
      openrouter: Boolean(current.values.openrouter),
      github: Boolean(current.values.github),
      vercel: Boolean(current.values.vercel),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

  private async readFile(): Promise<SecretsFile> {
    return await readJsonFile<SecretsFile>(this.secretsPath, {
      encrypted: safeStorage.isEncryptionAvailable(),
      values: {}
    });
  }
}
