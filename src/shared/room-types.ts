/**
 * Shared room DTOs crossed over the preload bridge (main ↔ renderer).
 * Keep this module free of Electron and Node-only imports so the renderer
 * can import the types without pulling main-process code.
 */

export type AuthorType = "user" | "agent" | "system";

export type PresenceState =
  | "connecting"
  | "idle"
  | "thinking"
  | "runningTool"
  | "error"
  | "offline"
  | "stopped";

export type FailureKind = "auth" | "rate_limit" | "crash" | "hang";

export interface RoomMessageDto {
  id: number;
  seq: number;
  authorType: AuthorType;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
  /** True when the turn was cancelled mid-stream and this is the partial. */
  interrupted?: boolean;
}

export interface AgentFailureDto {
  kind: FailureKind;
  message: string;
  at: number;
  retryable: boolean;
}

export interface MemberDto {
  id: string;
  name: string;
  persona: string;
  presence: PresenceState;
  /** Short status under the name, e.g. "running search_web…". */
  statusLine: string | null;
  lastFailure: AgentFailureDto | null;
}

export interface RoomSnapshot {
  messages: RoomMessageDto[];
  members: MemberDto[];
}

/** Live push events from main → renderer. */
export type RoomPushEvent =
  | { type: "message"; message: RoomMessageDto }
  | { type: "presence"; member: MemberDto }
  | { type: "token"; agentId: string; agentName: string; text: string }
  | { type: "stream-end"; agentId: string; reason: "done" | "cancelled" | "error" }
  | { type: "failure"; agentId: string; failure: AgentFailureDto }
  | { type: "members"; members: MemberDto[] };

export interface PostMessageResult {
  seq: number;
  chainId: string;
}

/** Renderer-facing room client (IPC in production; fakes in tests). */
export interface RoomClient {
  getSnapshot(): Promise<RoomSnapshot>;
  postMessage(text: string): Promise<PostMessageResult>;
  cancelTurn(agentId: string): Promise<boolean>;
  retryAgent(agentId: string): Promise<void>;
  /** Subscribe to live room events. Returns unsubscribe. */
  subscribe(listener: (event: RoomPushEvent) => void): () => void;
}
