/**
 * Electron IPC registration for settings and the room surface.
 * Kept free of window creation so tests can exercise the channel map later.
 */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import type { AgentConfigInput } from "../shared/agent-config";
import type { RoomHost } from "./room-host";
import type { SettingsStore } from "./settings";

const ROOM_PUSH_CHANNEL = "room:event";

export interface IpcContext {
  settings: SettingsStore;
  /** Lazily resolved so bootstrap can register handlers before the host exists. */
  getRoomHost: () => RoomHost | null;
  getMainWindow: () => BrowserWindow | null;
}

let roomUnsubscribe: (() => void) | null = null;

export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.removeHandler("settings:get");
  ipcMain.removeHandler("settings:set");
  ipcMain.removeHandler("settings:set-api-key");
  ipcMain.removeHandler("settings:has-api-key");
  ipcMain.removeHandler("room:get-snapshot");
  ipcMain.removeHandler("room:post-message");
  ipcMain.removeHandler("room:cancel-turn");
  ipcMain.removeHandler("room:retry-agent");
  ipcMain.removeHandler("activity:get-snapshot");
  ipcMain.removeHandler("agents:get-options");
  ipcMain.removeHandler("agents:get-config");
  ipcMain.removeHandler("agents:create");
  ipcMain.removeHandler("agents:update");
  ipcMain.removeHandler("agents:remove");

  ipcMain.handle("settings:get", (_event: IpcMainInvokeEvent, key: string) => {
    return ctx.settings.get(key);
  });

  ipcMain.handle(
    "settings:set",
    (_event: IpcMainInvokeEvent, key: string, value: unknown) => {
      ctx.settings.set(key, value);
    },
  );

  ipcMain.handle(
    "settings:set-api-key",
    async (_event: IpcMainInvokeEvent, provider: string, apiKey: string) => {
      await ctx.settings.setApiKey(provider, apiKey);
    },
  );

  ipcMain.handle(
    "settings:has-api-key",
    (_event: IpcMainInvokeEvent, provider: string) => {
      return ctx.settings.getApiKey(provider) !== null;
    },
  );

  ipcMain.handle("room:get-snapshot", () => {
    const host = requireHost(ctx);
    return host.getSnapshot();
  });

  ipcMain.handle(
    "room:post-message",
    async (_event: IpcMainInvokeEvent, text: string) => {
      const host = requireHost(ctx);
      return host.postMessage(text);
    },
  );

  ipcMain.handle(
    "room:cancel-turn",
    (_event: IpcMainInvokeEvent, agentId: string) => {
      const host = requireHost(ctx);
      return host.cancelTurn(agentId);
    },
  );

  ipcMain.handle(
    "room:retry-agent",
    async (_event: IpcMainInvokeEvent, agentId: string) => {
      const host = requireHost(ctx);
      await host.retryAgent(agentId);
    },
  );

  ipcMain.handle("activity:get-snapshot", () => {
    const host = requireHost(ctx);
    return host.getActivitySnapshot();
  });

  ipcMain.handle("agents:get-options", () => {
    const host = requireHost(ctx);
    return host.getAgentOptions();
  });

  ipcMain.handle("agents:get-config", (_event: IpcMainInvokeEvent, agentId: string) => {
    const host = requireHost(ctx);
    return host.getAgentConfig(agentId);
  });

  ipcMain.handle(
    "agents:create",
    async (_event: IpcMainInvokeEvent, input: AgentConfigInput) => {
      const host = requireHost(ctx);
      return host.createAgent(input);
    },
  );

  ipcMain.handle(
    "agents:update",
    async (_event: IpcMainInvokeEvent, agentId: string, input: AgentConfigInput) => {
      const host = requireHost(ctx);
      return host.updateAgent(agentId, input);
    },
  );

  ipcMain.handle(
    "agents:remove",
    async (_event: IpcMainInvokeEvent, agentId: string) => {
      const host = requireHost(ctx);
      await host.removeAgent(agentId);
    },
  );
}

/** Attach the room host's push stream to the active BrowserWindow. */
export function bindRoomHostPush(
  host: RoomHost,
  getMainWindow: () => BrowserWindow | null,
): void {
  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }
  roomUnsubscribe = host.subscribe((event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(ROOM_PUSH_CHANNEL, event);
    }
  });
}

export function unbindRoomHostPush(): void {
  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }
}

function requireHost(ctx: IpcContext): RoomHost {
  const host = ctx.getRoomHost();
  if (!host) {
    throw new Error("room host is not ready");
  }
  return host;
}
