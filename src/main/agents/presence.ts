/**
 * Presence state machine: the single source of truth for an agent's
 * member-list/rail presence.
 *
 * States: connecting → idle → thinking → runningTool → error | offline → stopped.
 *
 * Transitions are driven ONLY by turn-runner events (`RoomEvent`) and
 * lifecycle signals from the session manager (instance ready, init failure,
 * restart, stop). Token arrival never changes presence —
 * `roomEventTransitions` maps `token` events to no transition.
 *
 * The machine is intentionally permissive about *ignoring* illegal
 * transitions (it stays in the current state) so a late or duplicate stream
 * event can never corrupt presence; `canTransition` exposes legality for
 * tests and assertions.
 */
import type { RoomEvent } from "./turn-runner";

export type PresenceState =
  | "connecting"
  | "idle"
  | "thinking"
  | "runningTool"
  | "error"
  | "offline"
  | "stopped";

/**
 * Symbolic transitions. Lifecycle signals (instanceReady, initFailed,
 * turnStarted, recovered, restart, declaredOffline, stop) are raised by the
 * session manager; the rest are derived from `RoomEvent`s.
 */
export type PresenceTransition =
  | "instanceReady"
  | "initFailed"
  | "turnStarted"
  | "phaseThinking"
  | "phaseRunningTool"
  | "toolCallStart"
  | "toolCallEnd"
  | "turnSettled"
  | "turnError"
  | "recovered"
  | "restart"
  | "declaredOffline"
  | "stop";

export const PRESENCE_TRANSITIONS: Record<
  PresenceTransition,
  Partial<Record<PresenceState, PresenceState>>
> = {
  // Lifecycle: instance creation resolved.
  instanceReady: { connecting: "idle" },
  initFailed: { connecting: "offline" },
  // Lifecycle: a turn begins executing on an idle agent.
  turnStarted: { idle: "thinking" },
  // Stream phase events.
  phaseThinking: { idle: "thinking", runningTool: "thinking" },
  phaseRunningTool: { thinking: "runningTool", idle: "runningTool" },
  // tool_call.start always moves a working agent into runningTool.
  toolCallStart: { thinking: "runningTool", idle: "runningTool" },
  // tool_call.end returns the agent to thinking.
  toolCallEnd: { runningTool: "thinking" },
  // turn.end(done | cancelled) settles the agent back to idle.
  turnSettled: { thinking: "idle", runningTool: "idle" },
  // turn.end(error) — also allowed from idle for hangs surfaced after abort.
  turnError: { thinking: "error", runningTool: "error", idle: "error" },
  // Lifecycle: a fresh turn may run after a recovered error.
  recovered: { error: "idle" },
  // Lifecycle: one auto-restart or a manual retry re-enters connecting.
  restart: { error: "connecting", offline: "connecting" },
  // Lifecycle: unrecoverable — offline until manual retry.
  declaredOffline: {
    connecting: "offline",
    idle: "offline",
    thinking: "offline",
    runningTool: "offline",
    error: "offline",
  },
  // Lifecycle: remove agent / app quit — terminal.
  stop: {
    connecting: "stopped",
    idle: "stopped",
    thinking: "stopped",
    runningTool: "stopped",
    error: "stopped",
    offline: "stopped",
  },
};

/**
 * Map a turn-runner event to presence transitions. `token` events
 * deliberately map to nothing: presence reflects run state, not output
 * volume.
 */
export function roomEventTransitions(event: RoomEvent): PresenceTransition[] {
  switch (event.kind) {
    case "token":
      return [];
    case "tool_call.start":
      return ["toolCallStart"];
    case "tool_call.end":
      return ["toolCallEnd"];
    case "status":
      if (event.phase === "thinking") return ["phaseThinking"];
      if (event.phase === "running-tool") return ["phaseRunningTool"];
      return ["turnSettled"];
    case "turn.end":
      return event.reason === "error" ? ["turnError"] : ["turnSettled"];
  }
}

/** Per-agent presence state machine. Starts in `connecting`. */
export class PresenceMachine {
  private current: PresenceState;

  constructor(initial: PresenceState = "connecting") {
    this.current = initial;
  }

  get state(): PresenceState {
    return this.current;
  }

  canTransition(transition: PresenceTransition): boolean {
    return PRESENCE_TRANSITIONS[transition][this.current] !== undefined;
  }

  /**
   * Apply a transition. Illegal transitions are ignored (the machine stays
   * put) and the resulting state is returned either way.
   */
  transition(transition: PresenceTransition): PresenceState {
    const next = PRESENCE_TRANSITIONS[transition][this.current];
    if (next !== undefined) {
      this.current = next;
    }
    return this.current;
  }
}
