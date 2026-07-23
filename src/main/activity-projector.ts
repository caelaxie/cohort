/**
 * Activity projector (U7; R8, AE4, KTD11): folds the room store's persisted
 * turn-event log into per-agent activity records for the rail.
 *
 * The store's event log is the projector's persistence (KTD4-style: one
 * source of truth). The constructor folds the full existing log, so a
 * main-process restart or a reloaded renderer catches up from the same
 * records the live path folds — no separate snapshot format, no duplicates.
 *
 * Fold rules:
 * - `turn.begin` (written by the broker at dispatch) opens a TurnActivity and
 *   records which chat message seqs spawned the work, so cards can link back
 *   to the conversation.
 * - `tool_call.start` / `tool_call.end` open and close cards; a call carrying
 *   a subgraph namespace (`ns`) nests one level under the most recent open
 *   top-level card. Durations come from event `createdAt` stamps.
 * - `write_file` / `edit_file` calls contribute produced items (KTD11),
 *   deduped by path keeping the latest write.
 * - `turn.end` settles the turn; still-open cards are marked interrupted on
 *   cancellation and errored on failure. `failure` events settle the turn as
 *   failed (F5).
 * - Completed turns are retained newest-first, bounded per agent.
 */
import type {
  AgentActivityDto,
  ToolCallDto,
  ToolCallStatus,
  TurnOutcomeKind,
} from "../shared/room-types";
import type { RoomEventRecord, RoomStore } from "./room-store";

/** Default number of completed turns retained per agent. */
export const DEFAULT_MAX_RECENT_TURNS = 3;

/** File tools whose writes count as produced items (KTD11). */
const PRODUCING_TOOLS = new Set(["write_file", "edit_file"]);

export interface ActivityProjectorOptions {
  store: RoomStore;
  /** Completed turns retained per agent (default {@link DEFAULT_MAX_RECENT_TURNS}). */
  maxRecentTurns?: number;
}

export type ActivityListener = (
  agentId: string,
  activity: AgentActivityDto,
  eventSeq: number,
) => void;


interface MutableTurn {
  turnId: string;
  originSeqs: number[];
  startedAt: number;
  endedAt?: number;
  outcome?: TurnOutcomeKind;
  toolCalls: ToolCallDto[];
  produced: { path: string; toolCallId: string }[];
}

interface AgentState {
  lastActiveAt: number | null;
  current: MutableTurn | null;
  /** Newest first. */
  recent: MutableTurn[];
}

export class ActivityProjector {
  private readonly store: RoomStore;
  private readonly maxRecentTurns: number;
  private readonly agents = new Map<string, AgentState>();
  private readonly listeners = new Set<ActivityListener>();
  private readonly unsubscribe: () => void;
  private highWaterSeq = 0;

  constructor(options: ActivityProjectorOptions) {
    this.store = options.store;
    this.maxRecentTurns = options.maxRecentTurns ?? DEFAULT_MAX_RECENT_TURNS;
    for (const record of this.store.listEvents()) {
      this.fold(record, false);
    }
    this.unsubscribe = this.store.subscribeEvents((record) => {
      this.fold(record, true);
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  /** Subscribe to per-agent activity changes. Returns unsubscribe. */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getActivity(agentId: string): AgentActivityDto | null {
    const state = this.agents.get(agentId);
    if (!state) return null;
    return this.toDto(agentId, state);
  }

  getSnapshot(): { activities: AgentActivityDto[]; highWaterSeq: number } {
    return {
      activities: [...this.agents.keys()].map((id) => this.getActivity(id)!),
      highWaterSeq: this.highWaterSeq,
    };
  }

  /** Highest event-log seq folded so far. */
  getHighWaterSeq(): number {
    return this.highWaterSeq;
  }

  // ------------------------------------------------------------------
  // Fold
  // ------------------------------------------------------------------

  private fold(record: RoomEventRecord, notify: boolean): void {
    this.highWaterSeq = Math.max(this.highWaterSeq, record.seq);
    const state = this.stateFor(record.agentId);
    state.lastActiveAt = record.createdAt;

    switch (record.kind) {
      case "turn.begin":
        this.beginTurn(state, record);
        break;
      case "tool_call.start":
        this.startToolCall(state, record);
        break;
      case "tool_call.end":
        this.endToolCall(state, record);
        break;
      case "turn.end":
        this.settleTurn(state, record, this.outcomeFor(record));
        break;
      case "failure":
        this.settleTurn(state, record, "failed");
        break;
      default:
        // token/status: liveness only (tracked via lastActiveAt above).
        break;
    }

    if (notify) {
      const dto = this.toDto(record.agentId, state);
      for (const listener of this.listeners) {
        listener(record.agentId, dto, record.seq);
      }
    }
  }

  private stateFor(agentId: string): AgentState {
    let state = this.agents.get(agentId);
    if (!state) {
      state = { lastActiveAt: null, current: null, recent: [] };
      this.agents.set(agentId, state);
    }
    return state;
  }

  private beginTurn(state: AgentState, record: RoomEventRecord): void {
    // A new turn while one is still open means the previous turn never
    // closed (crash/quit): retire it as interrupted before opening the new.
    if (state.current) {
      this.closeTurn(state, record.createdAt, "cancelled");
    }
    const payload = (record.payload ?? {}) as { triggerSeqs?: unknown };
    const originSeqs = Array.isArray(payload.triggerSeqs)
      ? payload.triggerSeqs.filter((s): s is number => typeof s === "number")
      : [];
    state.current = {
      turnId: record.turnId ?? `turn@${record.seq}`,
      originSeqs,
      startedAt: record.createdAt,
      toolCalls: [],
      produced: [],
    };
  }

  private startToolCall(state: AgentState, record: RoomEventRecord): void {
    const turn = this.ensureTurn(state, record);
    const payload = (record.payload ?? {}) as {
      id?: string;
      name?: string;
      input?: unknown;
      ns?: string[];
    };
    const card: ToolCallDto = {
      id: payload.id ?? `call@${record.seq}`,
      name: payload.name ?? "unknown",
      status: "running",
      input: payload.input,
      startedAt: record.createdAt,
      children: [],
    };
    const ns = Array.isArray(payload.ns) ? payload.ns : [];
    if (ns.length > 0) {
      // Subagent step: nest one level under the most recent open top-level card.
      const parent = [...turn.toolCalls].reverse().find((c) => c.status === "running");
      if (parent) {
        parent.children.push(card);
      } else {
        turn.toolCalls.push(card);
      }
    } else {
      turn.toolCalls.push(card);
    }

    if (PRODUCING_TOOLS.has(card.name)) {
      const path = producedPath(payload.input);
      if (path) {
        // Dedupe by path; the latest write wins.
        turn.produced = turn.produced.filter((p) => p.path !== path);
        turn.produced.push({ path, toolCallId: card.id });
      }
    }
  }

  private endToolCall(state: AgentState, record: RoomEventRecord): void {
    const turn = state.current;
    if (!turn) return;
    const payload = (record.payload ?? {}) as {
      id?: string;
      output?: unknown;
      error?: string;
    };
    const card = payload.id ? findCard(turn.toolCalls, payload.id) : undefined;
    if (!card || card.status !== "running") return;
    card.status = payload.error !== undefined ? "error" : "done";
    if (payload.error !== undefined) {
      card.error = payload.error;
    } else {
      card.output = payload.output;
    }
    card.durationMs = record.createdAt - card.startedAt;
  }

  private outcomeFor(record: RoomEventRecord): TurnOutcomeKind {
    const payload = (record.payload ?? {}) as { reason?: string };
    if (payload.reason === "cancelled") return "cancelled";
    if (payload.reason === "error") return "error";
    return "done";
  }

  private settleTurn(
    state: AgentState,
    record: RoomEventRecord,
    outcome: TurnOutcomeKind,
  ): void {
    if (!state.current) return;
    this.closeTurn(state, record.createdAt, outcome);
  }

  private closeTurn(
    state: AgentState,
    endedAt: number,
    outcome: TurnOutcomeKind,
  ): void {
    const turn = state.current;
    if (!turn) return;
    // Any card still open when the turn settles did not finish cleanly.
    const orphanStatus: ToolCallStatus =
      outcome === "done" ? "interrupted" : outcome === "cancelled" ? "interrupted" : "error";
    for (const card of turn.toolCalls) {
      closeIfRunning(card, endedAt, orphanStatus);
    }
    turn.endedAt = endedAt;
    turn.outcome = outcome;
    state.recent.unshift(turn);
    if (state.recent.length > this.maxRecentTurns) {
      state.recent.length = this.maxRecentTurns;
    }
    state.current = null;
  }

  /** Events can arrive without a turn.begin (pre-U7 logs); synthesize a shell. */
  private ensureTurn(state: AgentState, record: RoomEventRecord): MutableTurn {
    if (!state.current) {
      state.current = {
        turnId: record.turnId ?? `turn@${record.seq}`,
        originSeqs: [],
        startedAt: record.createdAt,
        toolCalls: [],
        produced: [],
      };
    }
    return state.current;
  }

  private toDto(agentId: string, state: AgentState): AgentActivityDto {
    return {
      agentId,
      agentName: this.store.getAgent(agentId)?.name ?? agentId,
      lastActiveAt: state.lastActiveAt,
      current: state.current ? { ...state.current } : null,
      recent: state.recent.map((turn) => ({ ...turn })),
    };
  }
}

function findCard(cards: ToolCallDto[], id: string): ToolCallDto | undefined {
  for (const card of cards) {
    if (card.id === id) return card;
    const nested = findCard(card.children as ToolCallDto[], id);
    if (nested) return nested;
  }
  return undefined;
}

function closeIfRunning(
  card: ToolCallDto,
  endedAt: number,
  status: ToolCallStatus,
): void {
  if (card.status === "running") {
    card.status = status;
    card.durationMs = endedAt - card.startedAt;
  }
  for (const child of card.children as ToolCallDto[]) {
    closeIfRunning(child, endedAt, status);
  }
}

/** Extract the workspace path a producing tool call writes to. */
function producedPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const path = record.file_path ?? record.path;
  return typeof path === "string" && path.length > 0 ? path : null;
}
