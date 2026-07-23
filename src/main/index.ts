import { app, safeStorage, type BrowserWindow } from "electron";
import { join } from "node:path";

import { bindRoomHostPush, registerIpcHandlers, unbindRoomHostPush } from "./ipc";
import { defaultRoomPaths, RoomHost } from "./room-host";
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

let mainWindow: BrowserWindow | null = null;
let roomHost: RoomHost | null = null;
let settings: SettingsStore | null = null;
let quitting = false;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function getRoomHost(): RoomHost | null {
  return roomHost;
}

async function bootstrap(): Promise<void> {
  assertNodeFloor();

  if (!settings) {
    settings = new SettingsStore({
      userDataDir: app.getPath("userData"),
      safeStorage,
    });
    settings.load();
  }

  if (!roomHost) {
    const paths = defaultRoomPaths(app.getPath("userData"));
    roomHost = new RoomHost({ roomDbPath: paths.roomDbPath });
    bindRoomHostPush(roomHost, getMainWindow);
  }

  registerIpcHandlers({
    settings,
    getRoomHost,
    getMainWindow,
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  mainWindow = createMainWindow({
    preloadPath: join(__dirname, "../preload/index.js"),
    devServerUrl: process.env.ELECTRON_RENDERER_URL,
    rendererHtmlPath: process.env.ELECTRON_RENDERER_URL
      ? undefined
      : join(__dirname, "../renderer/index.html"),
  });

  // Re-bind push now that the window exists.
  if (roomHost) {
    bindRoomHostPush(roomHost, getMainWindow);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  unbindRoomHostPush();
  if (roomHost) {
    const markers = await roomHost.sessions.shutdown();
    for (const marker of markers) {
      roomHost.broker.recordInterruption(marker);
    }
    await roomHost.broker.idle();
    roomHost.dispose();
    roomHost.store.close();
    roomHost = null;
  }
}

app.whenReady().then(() => {
  void bootstrap();
  app.on("activate", () => {
    // macOS: re-create the window when the dock icon is clicked and none exist.
    void bootstrap();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void shutdown().finally(() => {
    app.exit(0);
  });
});
