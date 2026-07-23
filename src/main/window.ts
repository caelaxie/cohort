import { BrowserWindow } from "electron";

export interface MainWindowOptions {
  preloadPath: string;
  /** Dev-server URL when running under electron-vite dev; omit for packaged builds. */
  devServerUrl?: string;
  /** Renderer entry for packaged builds. */
  rendererHtmlPath?: string;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (options.devServerUrl) {
    void win.loadURL(options.devServerUrl);
  } else if (options.rendererHtmlPath) {
    void win.loadFile(options.rendererHtmlPath);
  }

  return win;
}
