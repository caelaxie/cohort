import { app, safeStorage } from "electron";
import { join } from "node:path";
import { SettingsStore } from "./settings";
import { createMainWindow } from "./window";

/** deepagents requires Node >= 20; Electron's embedded Node must satisfy that floor. */
function assertNodeFloor(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    throw new Error(
      `Agent Room requires Node >= 20 (Electron embedded Node is ${process.versions.node}). Upgrade Electron.`,
    );
  }
}

function bootstrap(): void {
  assertNodeFloor();

  const settings = new SettingsStore({
    userDataDir: app.getPath("userData"),
    safeStorage,
  });
  settings.load();

  createMainWindow({
    preloadPath: join(__dirname, "../preload/index.js"),
    devServerUrl: process.env.ELECTRON_RENDERER_URL,
    rendererHtmlPath: process.env.ELECTRON_RENDERER_URL
      ? undefined
      : join(__dirname, "../renderer/index.html"),
  });
}

app.whenReady().then(() => {
  bootstrap();
  app.on("activate", () => {
    // macOS: re-create the window when the dock icon is clicked and none exist.
    bootstrap();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
