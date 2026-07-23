import type { AgentRoomApi } from "../../preload/index";

declare global {
  interface Window {
    agentRoom: AgentRoomApi;
  }
}

export {};
