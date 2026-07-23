import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  ActivitySnapshot,
  PostMessageResult,
  RoomClient,
  RoomPushEvent,
  RoomSnapshot,
} from "../shared/room-types";

const room: RoomClient = {
  getSnapshot: (): Promise<RoomSnapshot> => ipcRenderer.invoke("room:get-snapshot"),
  getActivitySnapshot: (): Promise<ActivitySnapshot> =>
    ipcRenderer.invoke("activity:get-snapshot"),
  postMessage: (text: string): Promise<PostMessageResult> =>
    ipcRenderer.invoke("room:post-message", text),
  cancelTurn: (agentId: string): Promise<boolean> =>
    ipcRenderer.invoke("room:cancel-turn", agentId),
  retryAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke("room:retry-agent", agentId),
  subscribe: (listener: (event: RoomPushEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: RoomPushEvent): void => {
      listener(payload);
    };
    ipcRenderer.on("room:event", handler);
    return () => {
      ipcRenderer.removeListener("room:event", handler);
    };
  },
};

const api = {
  settings: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke("settings:set", key, value),
    setApiKey: (provider: string, apiKey: string): Promise<void> =>
      ipcRenderer.invoke("settings:set-api-key", provider, apiKey),
    hasApiKey: (provider: string): Promise<boolean> =>
      ipcRenderer.invoke("settings:has-api-key", provider),
  },
  room,
};

export type AgentRoomApi = typeof api;

contextBridge.exposeInMainWorld("agentRoom", api);
