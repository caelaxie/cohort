/**
 * Session manager: owns each room agent's lifecycle
 * in the main process and exposes truthful presence plus a subscription API
 * for the (later) UI.
 *
 * Responsibilities:
 * - Registers agents from plain config and starts them at app launch via the
 *   agent factory (`createRoomAgent` by default; injectable for tests).
 * - Runs turns through the turn runner, driving presence from `RoomEvent`s
 *   and lifecycle signals only (see `presence.ts`) — never from tokens.
 * - Failure taxonomy, distinguishable by consumers (`AgentFailure.kind`):
 *   `auth` (bad API key — no auto-restart), `rate_limit` (one backoff
 *   recovery, instance retained), `crash` (one automatic restart via the
 *   factory), `hang` (per-turn wall-clock timeout, injectable).
 * - Crash policy: exactly ONE automatic restart with backoff, then `offline`
 *   with a manual retry affordance (`retryAgent`). No restart loops. Init
 *   failure lands in `offline` directly and gets the same single auto-retry
 *   budget.
 * - Send API: `sendTurn` queues while the agent is connecting (delivered in
 *   order once idle) and serializes turns per agent; `cancelTurn` aborts the
 *   in-flight turn via its AbortController.
 * - Quit: `shutdown()` aborts in-flight turns (turn.end(cancelled)), records
 *   one interruption marker per busy agent (returned and retained for a
 *   later unit to persist), and clears every timer so no handles dangle.
 *
 * Deliberately Electron-free and persistence-free: the room store, broker,
 * and IPC wiring are later units.
 */
import type { BaseMessageLike } from "@langchain/core/messages";

import {
  createRoomAgent,
  type RoomAgent,
  type RoomAgentConfig,
} from "./agent-factory";
import {
  PresenceMachine,
  roomEventTransitions,
  type PresenceState,
  type PresenceTransition,
} from "./presence";
import { runTurn, type RoomEvent } from "./turn-runner";

/** Failure taxonomy, surfaced to consumers via `AgentFailure.kind`. */
export type FailureKind = "auth" | "rate_limit" | "crash" | "hang";

export interface AgentFailure {
  kind: FailureKind;
  message: string;
  at: number;
  /** True while a manual retry (`retryAgent`) is available. */
  retryable: boolean;
}

export interface TurnOutcome {
  reason: "done" | "cancelled" | "error";
  error?: string;
  /** Present when the turn failed and the manager applied the failure policy. */
  failure?: AgentFailure;
}

/** Recorded for every agent whose turn was aborted by `shutdown()`. */
export interface InterruptionMarker {
  agentId: string;
  agentName: string;
  reason: "shutdown";
  /** Presence at the moment of interruption. */
  interruptedFrom: PresenceState;
  /** Messages still queued for this agent when the app quit. */
  queuedMessages: number;
  at: number;
}

export type SessionEvent =
  | {
      type: "presence";
      agentId: string;
      previous: PresenceState;
      state: PresenceState;
    }
  | { type: "turn.event"; agentId: string; event: RoomEvent }
  | { type: "failure"; agentId: string; failure: AgentFailure }
  | { type: "interruption"; agentId: string; marker: InterruptionMarker };

export interface AgentSnapshot {
  id: string;
  name: string;
  presence: PresenceState;
  lastFailure: AgentFailure | null;
}

/** Plain config for one room agent, owned by the session manager. */
export interface AgentSessionConfig {
  id: string;
  name: string;
  model?: RoomAgentConfig["model"];
  systemPrompt?: RoomAgentConfig["systemPrompt"];
  tools?: RoomAgentConfig["tools"];
  /** Filesystem built-in allowlist for per-agent tool sets. */
  fsTools?: RoomAgentConfig["fsTools"];
  /** Per-agent memory overrides. */
  memory?: RoomAgentConfig["memory"];
}

/**
 * Factory seam. May return a promise so initialization can be asynchronous;
 * agents stay in `connecting` until it resolves.
 */
export type AgentFactory = (
  config: RoomAgentConfig,
) => RoomAgent | Promise<RoomAgent>;

export interface SessionManagerOptions {
  factory?: AgentFactory;
  /** Per-turn wall-clock timeout; a turn exceeding it is a hang. */
  turnTimeoutMs?: number;
  /** Backoff before the single automatic crash/rate-limit recovery. */
  restartBackoffMs?: number;
  /** Backoff before the single automatic init retry. */
  initRetryBackoffMs?: number;
  /** Maps an error message onto the failure taxonomy (never `hang`). */
  classifyError?: (message: string) => FailureKind;
}

/** Default error classifier: auth and rate-limit signatures, else crash. */
export function defaultClassifyError(message: string): FailureKind {
  const m = message.toLowerCase();
  if (/(401|403|unauthorized|forbidden|invalid api key|authentication|api key)/.test(m)) {
    return "auth";
  }
  if (/(429|rate.?limit|too many requests|quota)/.test(m)) {
    return "rate_limit";
  }
  return "crash";
}

interface QueuedTurn {
  messages: BaseMessageLike[];
  resolve: (outcome: TurnOutcome) => void;
}

interface ActiveTurn {
  controller: AbortController;
  hangFired: boolean;
  hangTimer: ReturnType<typeof setTimeout>;
}

interface AgentSession {
  id: string;
  name: string;
  config: AgentSessionConfig;
  machine: PresenceMachine;
  agent: RoomAgent | null;
  queue: QueuedTurn[];
  activeTurn: ActiveTurn | null;
  currentExecution: Promise<void> | null;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
  /** Automatic crash/rate-limit recoveries used. Capped at 1 — no loops. */
  restartsUsed: number;
  /** Automatic init retries used. Capped at 1 — no failure spam. */
  initRetriesUsed: number;
  lastFailure: AgentFailure | null;
  /** Recreate with the updated config once the in-flight turn settles. */
  pendingRecreate: boolean;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function toRoomConfig(config: AgentSessionConfig): RoomAgentConfig {
  return {
    id: config.id,
    model: config.model,
    systemPrompt: config.systemPrompt,
    tools: config.tools,
    fsTools: config.fsTools,
    memory: config.memory,
    name: config.name,
  };
}

export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private readonly interruptions: InterruptionMarker[] = [];
  private readonly factory: AgentFactory;
  private readonly turnTimeoutMs: number;
  private readonly restartBackoffMs: number;
  private readonly initRetryBackoffMs: number;
  private readonly classifyError: (message: string) => FailureKind;
  private shuttingDown = false;

  constructor(options: SessionManagerOptions = {}) {
    this.factory = options.factory ?? ((config) => createRoomAgent(config));
    this.turnTimeoutMs = options.turnTimeoutMs ?? 120_000;
    this.restartBackoffMs = options.restartBackoffMs ?? 1_000;
    this.initRetryBackoffMs = options.initRetryBackoffMs ?? 1_000;
    this.classifyError = options.classifyError ?? defaultClassifyError;
  }

  // ------------------------------------------------------------------
  // Registration and lifecycle
  // ------------------------------------------------------------------

  /** Register an agent. It enters `connecting` until `start()` succeeds. */
  registerAgent(config: AgentSessionConfig): void {
    if (this.sessions.has(config.id)) {
      throw new Error(`agent already registered: ${config.id}`);
    }
    this.sessions.set(config.id, {
      id: config.id,
      name: config.name,
      config,
      machine: new PresenceMachine(),
      agent: null,
      queue: [],
      activeTurn: null,
      currentExecution: null,
      recoveryTimer: null,
      restartsUsed: 0,
      initRetriesUsed: 0,
      lastFailure: null,
      pendingRecreate: false,
    });
  }

  /** Start one agent (create its instance). */
  async start(agentId: string): Promise<void> {
    await this.initAgent(this.requireSession(agentId));
  }

  /** Start every registered agent (app launch). */
  async startAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((s) => this.initAgent(s)),
    );
  }

  /**
   * Manual retry affordance: bring an `offline`/`error` agent back to
   * `connecting` and attempt initialization once.
   */
  async retryAgent(agentId: string): Promise<void> {
    const s = this.requireSession(agentId);
    const state = s.machine.state;
    if (state !== "offline" && state !== "error") return;
    this.applyTransition(s, "restart");
    await this.initAgent(s);
  }

  /**
   * Apply a config update (edit flow). A mid-flight turn finishes on the
   * old config; the instance is recreated once it settles. Idle agents are
   * recreated immediately, so the next turn always uses the new config.
   */
  reconfigure(agentId: string, patch: Partial<AgentSessionConfig>): void {
    const s = this.requireSession(agentId);
    s.config = { ...s.config, ...patch, id: s.id };
    if (patch.name) s.name = patch.name;
    if (s.activeTurn) {
      s.pendingRecreate = true;
      return;
    }
    if (s.machine.state !== "stopped") {
      void this.recreateInstance(s);
    }
  }

  /**
   * Stop and unregister an agent (removal): abort any in-flight turn,
   * resolve queued sends as cancelled, wait for the turn loop to settle,
   * and drop the session. The agent's checkpoint file is left on disk.
   */
  async stopAgent(agentId: string): Promise<void> {
    const s = this.requireSession(agentId);
    if (s.recoveryTimer) {
      clearTimeout(s.recoveryTimer);
      s.recoveryTimer = null;
    }
    s.pendingRecreate = false;
    if (s.activeTurn) {
      s.activeTurn.controller.abort();
    }
    for (const queued of s.queue.splice(0)) {
      queued.resolve({ reason: "cancelled", error: "agent removed" });
    }
    if (s.currentExecution) {
      await s.currentExecution;
    }
    this.applyTransition(s, "stop");
    this.sessions.delete(agentId);
  }

  // ------------------------------------------------------------------
  // Observation API
  // ------------------------------------------------------------------

  /** Subscribe to session events. Returns an unsubscribe function. */
  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPresence(agentId: string): PresenceState {
    return this.requireSession(agentId).machine.state;
  }

  listAgents(): AgentSnapshot[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      name: s.name,
      presence: s.machine.state,
      lastFailure: s.lastFailure,
    }));
  }

  /** Interruption markers recorded at shutdown, for later persistence. */
  getInterruptionMarkers(): readonly InterruptionMarker[] {
    return this.interruptions;
  }

  /** Pending backoff/hang timers — must be 0 after `shutdown()`. */
  get activeTimerCount(): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.recoveryTimer) count += 1;
      if (s.activeTurn) count += 1;
    }
    return count;
  }

  // ------------------------------------------------------------------
  // Send / cancel
  // ------------------------------------------------------------------

  /**
   * Run a turn for an agent. Sends while the agent is `connecting` are
   * queued and delivered in order once it reaches `idle`; sends while a turn
   * is in flight are serialized behind it (per-agent FIFO until the
   * broker takes over folding).
   */
  sendTurn(
    agentId: string,
    messages: BaseMessageLike[],
  ): Promise<TurnOutcome> {
    const s = this.requireSession(agentId);
    const state = s.machine.state;
    if (state === "offline" || state === "stopped") {
      return Promise.resolve({
        reason: "error",
        error: `agent "${s.name}" is ${state}`,
      });
    }
    return new Promise<TurnOutcome>((resolve) => {
      s.queue.push({ messages, resolve });
      this.pumpQueue(s);
    });
  }

  /** Abort the agent's in-flight turn. Returns false if none is running. */
  cancelTurn(agentId: string): boolean {
    const s = this.requireSession(agentId);
    if (!s.activeTurn) return false;
    s.activeTurn.controller.abort();
    return true;
  }

  // ------------------------------------------------------------------
  // Shutdown
  // ------------------------------------------------------------------

  /**
   * Abort all in-flight turns, record an interruption marker per busy
   * agent, resolve queued sends as cancelled, stop every agent, and clear
   * all timers. Resolves once every turn loop has settled.
   */
  async shutdown(): Promise<InterruptionMarker[]> {
    this.shuttingDown = true;
    const markers: InterruptionMarker[] = [];
    for (const s of this.sessions.values()) {
      if (s.recoveryTimer) {
        clearTimeout(s.recoveryTimer);
        s.recoveryTimer = null;
      }
      if (s.activeTurn) {
        const marker: InterruptionMarker = {
          agentId: s.id,
          agentName: s.name,
          reason: "shutdown",
          interruptedFrom: s.machine.state,
          queuedMessages: s.queue.length,
          at: Date.now(),
        };
        markers.push(marker);
        this.emit({ type: "interruption", agentId: s.id, marker });
        s.activeTurn.controller.abort();
      }
      for (const queued of s.queue.splice(0)) {
        queued.resolve({ reason: "cancelled", error: "session shut down" });
      }
    }
    this.interruptions.push(...markers);
    await Promise.all(
      [...this.sessions.values()].map((s) => s.currentExecution),
    );
    for (const s of this.sessions.values()) {
      this.applyTransition(s, "stop");
    }
    return markers;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private requireSession(agentId: string): AgentSession {
    const s = this.sessions.get(agentId);
    if (!s) throw new Error(`unknown agent: ${agentId}`);
    return s;
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private applyTransition(
    s: AgentSession,
    transition: PresenceTransition,
  ): void {
    const previous = s.machine.state;
    const state = s.machine.transition(transition);
    if (state !== previous) {
      this.emit({ type: "presence", agentId: s.id, previous, state });
    }
  }

  private recordFailure(
    s: AgentSession,
    kind: FailureKind,
    message: string,
  ): AgentFailure {
    const failure: AgentFailure = {
      kind,
      message,
      at: Date.now(),
      retryable: true,
    };
    s.lastFailure = failure;
    this.emit({ type: "failure", agentId: s.id, failure });
    return failure;
  }

  /** Create (or re-create) the agent instance; drive connecting → idle|offline. */
  private async initAgent(s: AgentSession): Promise<void> {
    try {
      s.agent = await this.factory(toRoomConfig(s.config));
      if (s.machine.state === "stopped") return;
      this.applyTransition(s, "instanceReady");
      this.pumpQueue(s);
    } catch (err) {
      if (s.machine.state === "stopped" || this.shuttingDown) return;
      const message = describeError(err);
      const kind = this.classifyError(message);
      this.recordFailure(s, kind, message);
      // Init failure lands in offline directly.
      this.applyTransition(s, "initFailed");
      // Exactly one automatic retry — no restart loops, no failure spam.
      if (kind !== "auth" && s.initRetriesUsed < 1 && !this.shuttingDown) {
        s.initRetriesUsed += 1;
        s.recoveryTimer = setTimeout(() => {
          s.recoveryTimer = null;
          if (this.shuttingDown || s.machine.state === "stopped") return;
          this.applyTransition(s, "restart");
          void this.initAgent(s);
        }, this.initRetryBackoffMs);
      }
    }
  }

  /** Recreate the instance after a crash/hang or a config update. */
  private async recreateInstance(s: AgentSession): Promise<void> {
    // Legal from error/offline (recovery); from idle it's a no-op, which is
    // fine — a config-swap recreate doesn't churn presence.
    this.applyTransition(s, "restart");
    try {
      s.agent = await this.factory(toRoomConfig(s.config));
      if (s.machine.state === "stopped") return; // removed/stopped meanwhile
      if (s.machine.state === "connecting") {
        this.applyTransition(s, "instanceReady");
      }
      this.pumpQueue(s);
    } catch (err) {
      this.recordFailure(s, "crash", describeError(err));
      this.applyTransition(s, "declaredOffline");
    }
  }

  /** Recovery policy after a failed turn. */
  private applyRecoveryPolicy(s: AgentSession, kind: FailureKind): void {
    if (this.shuttingDown || s.machine.state === "stopped") return;
    // Auth failures never fix themselves; offline until manual retry.
    if (kind === "auth") {
      this.applyTransition(s, "declaredOffline");
      return;
    }
    // One automatic recovery, then offline with a manual retry affordance.
    if (s.restartsUsed >= 1) {
      this.applyTransition(s, "declaredOffline");
      return;
    }
    s.restartsUsed += 1;
    s.recoveryTimer = setTimeout(() => {
      s.recoveryTimer = null;
      if (this.shuttingDown || s.machine.state === "stopped") return;
      if (kind === "rate_limit") {
        // The instance is healthy; the provider asked us to slow down.
        this.applyTransition(s, "recovered");
        this.pumpQueue(s);
        return;
      }
      void this.recreateInstance(s);
    }, this.restartBackoffMs);
  }

  /** Start the next queued turn if the agent is idle. */
  private pumpQueue(s: AgentSession): void {
    if (this.shuttingDown) return;
    if (s.machine.state !== "idle" || s.activeTurn) return;
    const next = s.queue.shift();
    if (!next) return;
    const execution = this.executeTurn(s, next);
    s.currentExecution = execution;
    void execution.finally(() => {
      if (s.currentExecution === execution) s.currentExecution = null;
    });
  }

  private async executeTurn(
    s: AgentSession,
    queued: QueuedTurn,
  ): Promise<void> {
    const controller = new AbortController();
    const turn: ActiveTurn = {
      controller,
      hangFired: false,
      hangTimer: setTimeout(() => {
        turn.hangFired = true;
        controller.abort();
      }, this.turnTimeoutMs),
    };
    s.activeTurn = turn;
    this.applyTransition(s, "turnStarted");

    let outcome: TurnOutcome = {
      reason: "error",
      error: "turn ended without a terminal event",
    };
    try {
      const events = runTurn(s.agent as RoomAgent, queued.messages, controller.signal);
      for await (const event of events) {
        for (const t of roomEventTransitions(event)) {
          this.applyTransition(s, t);
        }
        this.emit({ type: "turn.event", agentId: s.id, event });
        if (event.kind === "turn.end") {
          outcome = { reason: event.reason };
          if (event.error) outcome = { ...outcome, error: event.error };
        }
      }
    } catch (err) {
      outcome = { reason: "error", error: describeError(err) };
    } finally {
      clearTimeout(turn.hangTimer);
      s.activeTurn = null;
    }

    if (turn.hangFired) {
      // The abort surfaces as turn.end(cancelled); re-enter error so the
      // hang follows the crash path instead of reading as a clean cancel.
      const failure = this.recordFailure(
        s,
        "hang",
        `turn exceeded the ${this.turnTimeoutMs}ms wall-clock limit`,
      );
      outcome = { reason: "error", error: failure.message, failure };
      this.applyTransition(s, "turnError");
      this.applyRecoveryPolicy(s, "hang");
    } else if (outcome.reason === "error") {
      const kind = this.classifyError(outcome.error ?? "");
      const failure = this.recordFailure(
        s,
        kind,
        outcome.error ?? "unknown error",
      );
      outcome = { ...outcome, failure };
      this.applyRecoveryPolicy(s, kind);
    }

    queued.resolve(outcome);
    if (s.pendingRecreate) {
      // Config changed mid-turn: the turn just finished on the old
      // config; recreate so the NEXT turn uses the new one. The recreate
      // pumps the queue once the fresh instance is ready.
      s.pendingRecreate = false;
      void this.recreateInstance(s);
      return;
    }
    this.pumpQueue(s);
  }
}
