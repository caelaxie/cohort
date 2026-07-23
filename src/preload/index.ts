import { contextBridge, ipcRenderer } from "electron";

const api = {
  settings: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke("settings:set", key, value),
    setApiKey: (provider: string, apiKey: string): Promise<void> =>
      ipcRenderer.invoke("settings:set-api-key", provider, apiKey),
    hasApiKey: (provider: string): Promise<boolean> =>
      ipcRenderer.invoke("settings:has-api-key", provider),
  },
};

export type AgentRoomApi = typeof api;

contextBridge.exposeInMainWorld("agentRoom", api);
