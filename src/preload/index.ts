import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { AgentConfigInput } from "../shared/agent-config";
import type {
  ActivitySnapshot,
  AgentConfigDto,
  AgentOptionsDto,
  PostMessageResult,
  RoomClient,
  RoomPushEvent,
  RoomSnapshot,
  SaveAgentResult,
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
  getAgentOptions: (): Promise<AgentOptionsDto> => ipcRenderer.invoke("agents:get-options"),
  getAgentConfig: (agentId: string): Promise<AgentConfigDto | null> =>
    ipcRenderer.invoke("agents:get-config", agentId),
  createAgent: (input: AgentConfigInput): Promise<SaveAgentResult> =>
    ipcRenderer.invoke("agents:create", input),
  updateAgent: (agentId: string, input: AgentConfigInput): Promise<SaveAgentResult> =>
    ipcRenderer.invoke("agents:update", agentId, input),
  removeAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke("agents:remove", agentId),
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
