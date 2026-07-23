import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AppSettings {
  version: 1;
  [key: string]: unknown;
}

/** Minimal subset of Electron's safeStorage, so tests can stub it. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class KeyValidationError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(`API key for ${provider} failed validation: ${message}`);
    this.name = "KeyValidationError";
    this.provider = provider;
  }
}

/**
 * Minimal preflight check that an API key works, before it is accepted.
 * Implementations must throw KeyValidationError on rejection.
 * Never called with a live network request in tests.
 */
export type ApiKeyValidator = (provider: string, apiKey: string) => Promise<void>;

export interface SettingsStoreOptions {
  userDataDir: string;
  safeStorage: SafeStorageLike;
  validateApiKey?: ApiKeyValidator;
}

const SETTINGS_FILE = "settings.json";
const KEYS_FILE = "keys.json";

function defaultSettings(): AppSettings {
  return { version: 1 };
}

export class SettingsStore {
  private readonly settingsPath: string;
  private readonly keysPath: string;
  private readonly safeStorage: SafeStorageLike;
  private readonly validateApiKey?: ApiKeyValidator;
  private settings: AppSettings = defaultSettings();
  private encryptedKeys: Record<string, string> = {};

  constructor(options: SettingsStoreOptions) {
    this.settingsPath = join(options.userDataDir, SETTINGS_FILE);
    this.keysPath = join(options.userDataDir, KEYS_FILE);
    this.safeStorage = options.safeStorage;
    this.validateApiKey = options.validateApiKey;
    mkdirSync(options.userDataDir, { recursive: true });
  }

  load(): AppSettings {
    this.settings = this.readJsonFile(this.settingsPath, defaultSettings);
    this.encryptedKeys = this.readJsonFile(this.keysPath, () => ({}));
    return this.settings;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.settings[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.settings[key] = value;
    this.writeJsonFile(this.settingsPath, this.settings);
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    if (this.validateApiKey) {
      await this.validateApiKey(provider, apiKey);
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is unavailable on this system");
    }
    this.encryptedKeys[provider] = this.safeStorage.encryptString(apiKey).toString("base64");
    this.writeJsonFile(this.keysPath, this.encryptedKeys);
  }

  getApiKey(provider: string): string | null {
    const encoded = this.encryptedKeys[provider];
    if (!encoded) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(encoded, "base64"));
    } catch {
      return null;
    }
  }

  private readJsonFile<T>(path: string, fallback: () => T): T {
    if (!existsSync(path)) {
      const value = fallback();
      this.writeJsonFile(path, value);
      return value;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      // Back up the corrupt file, then recreate from fallback.
      renameSync(path, `${path}.corrupt-${Date.now()}`);
      const value = fallback();
      this.writeJsonFile(path, value);
      return value;
    }
  }

  private writeJsonFile(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  }
}
