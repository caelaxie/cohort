import { describe, expect, it, vi } from "vitest";

import {
  createRoomAgent,
  type RoomAgent,
  type RoomAgentConfig,
} from "../agent-factory";
import {
  PresenceMachine,
  roomEventTransitions,
  type PresenceState,
} from "../presence";
import {
  defaultClassifyError,
  SessionManager,
  type AgentFailure,
} from "../session-manager";
import { StubChatModel, type StubReply } from "../stub-model";

const userMessage = [{ role: "user", content: "hi" }];

/**
 * A factory that builds stub-model agents, consuming one script per
 * creation. Extra creations fall back to a benign script so restart loops
 * would still be observable rather than crashing the harness.
 */
function stubFactory(scripts: StubReply[][]) {
  const queue = [...scripts];
  return vi.fn(
    (config: RoomAgentConfig): RoomAgent =>
      createRoomAgent({
        model: new StubChatModel({
          script: queue.shift() ?? [{ tokens: ["ok"] }],
        }),
        name: config.name,
      }),
  );
}

function collectPresence(manager: SessionManager): PresenceState[] {
  const states: PresenceState[] = [];
  manager.subscribe((e) => {
    if (e.type === "presence") states.push(e.state);
  });
  return states;
}

function collectFailures(manager: SessionManager): AgentFailure[] {
  const failures: AgentFailure[] = [];
  manager.subscribe((e) => {
    if (e.type === "failure") failures.push(e.failure);
  });
  return failures;
}

describe("PresenceMachine", () => {
  it("walks the happy-path lifecycle", () => {
    const m = new PresenceMachine();
    expect(m.state).toBe("connecting");
    m.transition("instanceReady");
    expect(m.state).toBe("idle");
    m.transition("turnStarted");
    expect(m.state).toBe("thinking");
    m.transition("toolCallStart");
    expect(m.state).toBe("runningTool");
    m.transition("toolCallEnd");
    expect(m.state).toBe("thinking");
    m.transition("turnSettled");
    expect(m.state).toBe("idle");
    m.transition("stop");
    expect(m.state).toBe("stopped");
  });

  it("ignores illegal transitions instead of corrupting state", () => {
    const m = new PresenceMachine("idle");
    expect(m.canTransition("instanceReady")).toBe(false);
    m.transition("instanceReady");
    expect(m.state).toBe("idle");
    m.transition("stop");
    m.transition("stop"); // terminal; second stop is a no-op
    expect(m.state).toBe("stopped");
  });

  it("error recovers to idle and can restart into connecting", () => {
    const m = new PresenceMachine("thinking");
    m.transition("turnError");
    expect(m.state).toBe("error");
    m.transition("restart");
    expect(m.state).toBe("connecting");
    m.transition("instanceReady");
    expect(m.state).toBe("idle");
  });

  it("derives transitions from turn-runner events, never from tokens", () => {
    expect(roomEventTransitions({ kind: "token", text: "x" })).toEqual([]);
    expect(
      roomEventTransitions({
        kind: "tool_call.start",
        id: "1",
        name: "t",
        input: {},
      }),
    ).toEqual(["toolCallStart"]);
    expect(
      roomEventTransitions({ kind: "tool_call.end", id: "1", name: "t" }),
    ).toEqual(["toolCallEnd"]);
    expect(roomEventTransitions({ kind: "status", phase: "thinking" })).toEqual(
      ["phaseThinking"],
    );
    expect(
      roomEventTransitions({ kind: "status", phase: "running-tool" }),
    ).toEqual(["phaseRunningTool"]);
    expect(roomEventTransitions({ kind: "status", phase: "idle" })).toEqual([
      "turnSettled",
    ]);
    expect(roomEventTransitions({ kind: "turn.end", reason: "done" })).toEqual(
      ["turnSettled"],
    );
    expect(
      roomEventTransitions({ kind: "turn.end", reason: "cancelled" }),
    ).toEqual(["turnSettled"]);
    expect(
      roomEventTransitions({ kind: "turn.end", reason: "error", error: "x" }),
    ).toEqual(["turnError"]);
  });
});

describe("defaultClassifyError", () => {
  it("distinguishes auth, rate-limit, and crash", () => {
    expect(defaultClassifyError("Error: 401 Unauthorized")).toBe("auth");
    expect(defaultClassifyError("Error: invalid API key")).toBe("auth");
    expect(defaultClassifyError("Error: 429 rate limit exceeded")).toBe(
      "rate_limit",
    );
    expect(defaultClassifyError("Error: boom")).toBe("crash");
  });
});

describe("SessionManager", () => {
  it("model crash mid-turn → error → exactly one auto-restart → idle", async () => {
    const factory = stubFactory([
      [{ tokens: ["partial"], error: new Error("model exploded") }],
      [{ tokens: ["again"], error: new Error("model exploded again") }],
    ]);
    const manager = new SessionManager({
      factory,
      restartBackoffMs: 10,
      turnTimeoutMs: 5_000,
    });
    const presences = collectPresence(manager);
    const failures = collectFailures(manager);
    manager.registerAgent({ id: "a", name: "Scout" });
    await manager.startAll();

    const outcome = await manager.sendTurn("a", userMessage);
    expect(outcome.reason).toBe("error");
    expect(outcome.failure?.kind).toBe("crash");
    expect(failures).toHaveLength(1);

    await vi.waitFor(() => expect(manager.getPresence("a")).toBe("idle"));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(presences).toEqual(["idle", "thinking", "error", "connecting", "idle"]);

    // A second crash exhausts the restart budget → offline, no loop.
    const second = await manager.sendTurn("a", userMessage);
    expect(second.reason).toBe("error");
    await vi.waitFor(() => expect(manager.getPresence("a")).toBe("offline"));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.activeTimerCount).toBe(0);

    await manager.shutdown();
  });

  it("init failure → offline with exactly one retry, no failure spam", async () => {
    const factory = vi.fn((): RoomAgent => {
      throw new Error("init exploded");
    });
    const manager = new SessionManager({ factory, initRetryBackoffMs: 10 });
    const failures = collectFailures(manager);
    manager.registerAgent({ id: "a", name: "Scout" });

    await manager.startAll();
    expect(manager.getPresence("a")).toBe("offline");
    expect(failures).toHaveLength(1);

    // The single automatic retry fires, fails again, and lands offline.
    await vi.waitFor(() => expect(failures).toHaveLength(2));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.getPresence("a")).toBe("offline");

    // No restart loop: nothing further happens and no timers dangle.
    await new Promise((r) => setTimeout(r, 50));
    expect(failures).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.activeTimerCount).toBe(0);

    await manager.shutdown();
  });

  it("auth failure during a turn → offline immediately, no auto-restart", async () => {
    const factory = stubFactory([
      [{ tokens: [], error: new Error("401 Unauthorized: invalid API key") }],
    ]);
    const manager = new SessionManager({ factory, restartBackoffMs: 10 });
    const failures = collectFailures(manager);
    manager.registerAgent({ id: "a", name: "Scout" });
    await manager.startAll();

    const outcome = await manager.sendTurn("a", userMessage);
    expect(outcome.reason).toBe("error");
    expect(outcome.failure?.kind).toBe("auth");
    expect(manager.getPresence("a")).toBe("offline");
    expect(failures.map((f) => f.kind)).toEqual(["auth"]);

    await new Promise((r) => setTimeout(r, 40));
    expect(factory).toHaveBeenCalledTimes(1);

    await manager.shutdown();
  });

  it("shutdown while three agents stream aborts turns, records markers, leaves no timers", async () => {
    const slowScript = (): StubReply[] => [
      { tokens: ["t1", "t2", "t3", "t4", "t5"], tokenDelayMs: 30 },
    ];
    const factory = vi.fn(
      (config: RoomAgentConfig): RoomAgent =>
        createRoomAgent({
          model: new StubChatModel({ script: slowScript() }),
          name: config.name,
        }),
    );
    const manager = new SessionManager({ factory, turnTimeoutMs: 5_000 });
    const streaming = new Set<string>();
    manager.subscribe((e) => {
      if (e.type === "turn.event" && e.event.kind === "token") {
        streaming.add(e.agentId);
      }
    });
    for (const id of ["a", "b", "c"]) {
      manager.registerAgent({ id, name: `Agent-${id}` });
    }
    await manager.startAll();

    const sends = ["a", "b", "c"].map((id) => manager.sendTurn(id, userMessage));
    // One more message queued behind an in-flight turn.
    const queued = manager.sendTurn("a", userMessage);

    await vi.waitFor(() => expect(streaming.size).toBe(3));

    const markers = await manager.shutdown();
    const outcomes = await Promise.all([...sends, queued]);

    expect(outcomes.every((o) => o.reason === "cancelled")).toBe(true);
    expect(markers).toHaveLength(3);
    expect(new Set(markers.map((m) => m.agentId))).toEqual(
      new Set(["a", "b", "c"]),
    );
    for (const marker of markers) {
      expect(marker.reason).toBe("shutdown");
      expect(marker.interruptedFrom).toBe("thinking");
    }
    expect(markers.find((m) => m.agentId === "a")?.queuedMessages).toBe(1);
    expect(manager.getInterruptionMarkers()).toHaveLength(3);

    for (const id of ["a", "b", "c"]) {
      expect(manager.getPresence(id)).toBe("stopped");
    }
    expect(manager.activeTimerCount).toBe(0);
  });

  it("hang (turn exceeds wall-clock timeout) → F5 path with failure surfaced", async () => {
    const factory = stubFactory([
      [{ tokens: ["slow", "slower"], tokenDelayMs: 200 }],
      [{ tokens: ["ok"] }],
    ]);
    const manager = new SessionManager({
      factory,
      turnTimeoutMs: 30,
      restartBackoffMs: 10,
    });
    const presences = collectPresence(manager);
    const failures = collectFailures(manager);
    manager.registerAgent({ id: "a", name: "Scout" });
    await manager.startAll();

    const outcome = await manager.sendTurn("a", userMessage);
    expect(outcome.reason).toBe("error");
    expect(outcome.failure?.kind).toBe("hang");
    expect(failures.map((f) => f.kind)).toEqual(["hang"]);
    expect(presences).toContain("error");

    // Hang follows the crash policy: one automatic restart, then idle.
    await vi.waitFor(() => expect(manager.getPresence("a")).toBe("idle"));
    expect(factory).toHaveBeenCalledTimes(2);

    await manager.shutdown();
  });

  it("message sent while connecting is queued and delivered when ready", async () => {
    let release!: (agent: RoomAgent) => void;
    const gate = new Promise<RoomAgent>((resolve) => {
      release = resolve;
    });
    const factory = vi.fn(() => gate);
    const manager = new SessionManager({ factory });
    const tokens: string[] = [];
    manager.subscribe((e) => {
      if (e.type === "turn.event" && e.event.kind === "token") {
        tokens.push(e.event.text);
      }
    });
    manager.registerAgent({ id: "a", name: "Scout" });
    const started = manager.startAll();
    expect(manager.getPresence("a")).toBe("connecting");

    const sent = manager.sendTurn("a", userMessage);
    // Still connecting: nothing delivered, nothing lost.
    expect(tokens).toEqual([]);

    release(
      createRoomAgent({
        model: new StubChatModel({ script: [{ tokens: ["hi", "there"] }] }),
        name: "Scout",
      }),
    );
    await started;

    const outcome = await sent;
    expect(outcome.reason).toBe("done");
    expect(tokens).toEqual(["hi", "there"]);
    expect(manager.getPresence("a")).toBe("idle");

    await manager.shutdown();
  });

  it("cancelTurn aborts the in-flight turn and presence returns to idle", async () => {
    const factory = stubFactory([
      [{ tokens: ["a", "b", "c"], tokenDelayMs: 50 }],
    ]);
    const manager = new SessionManager({ factory, turnTimeoutMs: 5_000 });
    manager.registerAgent({ id: "a", name: "Scout" });
    await manager.startAll();

    const sent = manager.sendTurn("a", userMessage);
    expect(manager.getPresence("a")).toBe("thinking");
    expect(manager.cancelTurn("a")).toBe(true);

    const outcome = await sent;
    expect(outcome.reason).toBe("cancelled");
    expect(manager.getPresence("a")).toBe("idle");

    await manager.shutdown();
  });
});
