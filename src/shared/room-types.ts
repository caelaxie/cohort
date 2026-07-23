/**
 * Shared room DTOs crossed over the preload bridge (main ↔ renderer).
 * Keep this module free of Electron and Node-only imports so the renderer
 * can import the types without pulling main-process code.
 */
import type {
  AgentAvatar,
  AgentConfigInput,
  AgentPreset,
  ToolSpec,
  ValidationErrors,
} from "./agent-config";

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
  /** Attribution captured at write time; survives later avatar edits. */
  avatar?: AgentAvatar;
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
  avatar?: AgentAvatar;
}

export interface RoomSnapshot {
  messages: RoomMessageDto[];
  members: MemberDto[];
}

// ---------------------------------------------------------------------
// Activity rail
// ---------------------------------------------------------------------

export type ToolCallStatus = "running" | "done" | "error" | "interrupted";

export interface ToolCallDto {
  /** Tool call id from the turn stream. */
  id: string;
  name: string;
  status: ToolCallStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  /** Set once the call closes (or is interrupted). */
  durationMs?: number;
  /** Subagent (subgraph namespace) steps nested one level under this card. */
  children: ToolCallDto[];
}

export interface ProducedItemDto {
  /** Workspace-relative path written during the turn. */
  path: string;
  toolCallId: string;
}

export type TurnOutcomeKind = "done" | "cancelled" | "error" | "failed";

export interface TurnActivityDto {
  turnId: string;
  /** Store seqs of the chat messages that spawned this turn. */
  originSeqs: number[];
  startedAt: number;
  endedAt?: number;
  outcome?: TurnOutcomeKind;
  toolCalls: ToolCallDto[];
  produced: ProducedItemDto[];
}

export interface AgentActivityDto {
  agentId: string;
  agentName: string;
  /** createdAt of the agent's most recent folded event, or null if none. */
  lastActiveAt: number | null;
  /** The live (or latest, if it never closed) turn. */
  current: TurnActivityDto | null;
  /** Completed turns, newest first, bounded per agent. */
  recent: TurnActivityDto[];
}

export interface ActivitySnapshot {
  activities: AgentActivityDto[];
  /** Highest event-log seq folded into this snapshot (replay high-water mark). */
  highWaterSeq: number;
}

/** Live push events from main → renderer. */
export type RoomPushEvent =
  | { type: "message"; message: RoomMessageDto }
  | { type: "presence"; member: MemberDto }
  | { type: "token"; agentId: string; agentName: string; text: string }
  | { type: "stream-end"; agentId: string; reason: "done" | "cancelled" | "error" }
  | { type: "failure"; agentId: string; failure: AgentFailureDto }
  | { type: "activity"; agentId: string; activity: AgentActivityDto; eventSeq: number }
  | { type: "members"; members: MemberDto[] };

export interface PostMessageResult {
  seq: number;
  chainId: string;
}

// ---------------------------------------------------------------------
// Agent builder and lifecycle
// ---------------------------------------------------------------------

/** Catalog + presets the builder renders from. */
export interface AgentOptionsDto {
  models: readonly { id: string; label: string }[];
  tools: readonly ToolSpec[];
  presets: readonly AgentPreset[];
}

/** A stored agent's editable config, for the builder's edit mode. */
export interface AgentConfigDto extends AgentConfigInput {
  id: string;
}

export type SaveAgentResult =
  | { ok: true; member: MemberDto }
  | { ok: false; errors: ValidationErrors };

/** Renderer-facing room client (IPC in production; fakes in tests). */
export interface RoomClient {
  getSnapshot(): Promise<RoomSnapshot>;
  getActivitySnapshot(): Promise<ActivitySnapshot>;
  postMessage(text: string): Promise<PostMessageResult>;
  cancelTurn(agentId: string): Promise<boolean>;
  retryAgent(agentId: string): Promise<void>;
  getAgentOptions(): Promise<AgentOptionsDto>;
  getAgentConfig(agentId: string): Promise<AgentConfigDto | null>;
  createAgent(input: AgentConfigInput): Promise<SaveAgentResult>;
  updateAgent(agentId: string, input: AgentConfigInput): Promise<SaveAgentResult>;
  removeAgent(agentId: string): Promise<void>;
  /** Subscribe to live room events. Returns unsubscribe. */
  subscribe(listener: (event: RoomPushEvent) => void): () => void;
}
