import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SettingsStore,
  KeyValidationError,
  type SafeStorageLike,
} from "../settings";

/** Reversible stand-in for Electron safeStorage. */
function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("bad cipher");
      return s.slice(4);
    },
  };
}

describe("SettingsStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-room-settings-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates default settings when the settings file is missing", () => {
    const store = new SettingsStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    const settings = store.load();
    expect(settings.version).toBe(1);
    expect(existsSync(join(dir, "settings.json"))).toBe(true);
  });

  it("backs up corrupted settings JSON and recreates defaults", () => {
    writeFileSync(join(dir, "settings.json"), "{ not json !!!", "utf8");
    const store = new SettingsStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    const settings = store.load();
    expect(settings.version).toBe(1);
    const backups = readdirSync(dir).filter((f) => f.startsWith("settings.json.corrupt-"));
    expect(backups.length).toBe(1);
    // Recreated file is valid JSON again.
    expect(() => JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).not.toThrow();
  });

  it("round-trips settings across reload", () => {
    const first = new SettingsStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    first.load();
    first.set("theme", "dark");
    const second = new SettingsStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(second.load().theme).toBe("dark");
  });

  it("rejects an invalid API key with a typed error and does not store it", async () => {
    const store = new SettingsStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage(),
      validateApiKey: async () => {
        throw new KeyValidationError("anthropic", "provider rejected the key");
      },
    });
    store.load();
    await expect(store.setApiKey("anthropic", "sk-bad")).rejects.toBeInstanceOf(KeyValidationError);
    expect(store.getApiKey("anthropic")).toBeNull();
  });

  it("stores a valid API key encrypted and never in the plain settings file", async () => {
    const store = new SettingsStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage(),
      validateApiKey: async () => {},
    });
    store.load();
    await store.setApiKey("anthropic", "sk-good-key");
    expect(store.getApiKey("anthropic")).toBe("sk-good-key");

    // Plain settings file must not contain the key material.
    const plainSettings = readFileSync(join(dir, "settings.json"), "utf8");
    expect(plainSettings).not.toContain("sk-good-key");

    // Whatever file holds the key must not contain it in plaintext either.
    const keyFiles = readdirSync(dir).filter((f) => f !== "settings.json" && !f.startsWith("settings.json.corrupt-"));
    for (const f of keyFiles) {
      expect(readFileSync(join(dir, f), "utf8")).not.toContain("sk-good-key");
    }

    // Survives reload.
    const reloaded = new SettingsStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage(),
      validateApiKey: async () => {},
    });
    reloaded.load();
    expect(reloaded.getApiKey("anthropic")).toBe("sk-good-key");
  });
});
