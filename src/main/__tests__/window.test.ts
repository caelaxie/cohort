import { describe, it, expect, vi } from "vitest";

// Mock electron before importing the window factory.
const browserWindowCtor = vi.fn();
vi.mock("electron", () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      browserWindowCtor(options);
    }
    loadURL = vi.fn();
    loadFile = vi.fn();
    on = vi.fn();
  },
}));

import { createMainWindow } from "../window";

describe("createMainWindow", () => {
  it("creates the window with hardened webPreferences", () => {
    createMainWindow({ preloadPath: "/app/preload/index.js" });
    expect(browserWindowCtor).toHaveBeenCalledTimes(1);
    const options = browserWindowCtor.mock.calls[0][0] as {
      webPreferences: Record<string, unknown>;
    };
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.nodeIntegration).toBe(false);
    expect(options.webPreferences.preload).toBe("/app/preload/index.js");
  });
});
