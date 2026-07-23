import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityProjector } from "../activity-projector";
import { RoomStore, type AppendEventInput } from "../room-store";
import type { AgentActivityDto } from "../../shared/room-types";

describe("ActivityProjector", () => {
  const stores: RoomStore[] = [];
  const projectors: ActivityProjector[] = [];

  afterEach(() => {
    for (const p of projectors.splice(0)) p.dispose();
    for (const s of stores.splice(0)) s.close();
  });

  function makeStore(): RoomStore {
    const store = new RoomStore(":memory:");
    stores.push(store);
    return store;
  }

  function makeProjector(
    store: RoomStore,
    options: { maxRecentTurns?: number } = {},
  ): ActivityProjector {
    const projector = new ActivityProjector({ store, ...options });
    projectors.push(projector);
    return projector;
  }

  function ev(
    store: RoomStore,
    input: AppendEventInput,
  ): void {
    store.appendEvent(input);
  }

  function activityOf(
    projector: ActivityProjector,
    agentId: string,
  ): AgentActivityDto {
    const activity = projector.getActivity(agentId);
    expect(activity).not.toBeNull();
    return activity!;
  }

  it("projects a running tool call mid-turn (AE4)", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [3], chainId: "user-3", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: { kind: "tool_call.start", id: "c1", name: "search_web", input: { q: "x" } },
      turnId: "turn-1",
      createdAt: 1100,
    });

    const activity = activityOf(projector, "scout");
    expect(activity.current).not.toBeNull();
    expect(activity.current!.originSeqs).toEqual([3]);
    expect(activity.current!.toolCalls).toHaveLength(1);
    const card = activity.current!.toolCalls[0];
    expect(card).toMatchObject({ id: "c1", name: "search_web", status: "running" });
    expect(card.startedAt).toBe(1100);
    expect(activity.lastActiveAt).toBe(1100);
  });

  it("closes cards with duration and settles the turn on turn.end", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [1], chainId: "user-1", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: { kind: "tool_call.start", id: "c1", name: "search_web", input: {} },
      turnId: "turn-1",
      createdAt: 1100,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.end",
      payload: { kind: "tool_call.end", id: "c1", name: "search_web", output: "results" },
      turnId: "turn-1",
      createdAt: 1600,
    });
    ev(store, {
      agentId: "scout",
      kind: "turn.end",
      payload: { kind: "turn.end", reason: "done" },
      turnId: "turn-1",
      createdAt: 1700,
    });

    const activity = activityOf(projector, "scout");
    expect(activity.current).toBeNull();
    expect(activity.recent).toHaveLength(1);
    const turn = activity.recent[0];
    expect(turn.outcome).toBe("done");
    expect(turn.endedAt).toBe(1700);
    expect(turn.toolCalls[0]).toMatchObject({
      status: "done",
      output: "results",
      durationMs: 500,
    });
  });

  it("derives produced items from workspace writes, deduped by path (KTD11)", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "muse",
      kind: "turn.begin",
      payload: { triggerSeqs: [2], chainId: "user-2", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "muse",
      kind: "tool_call.start",
      payload: {
        kind: "tool_call.start",
        id: "w1",
        name: "write_file",
        input: { file_path: "notes.md", content: "v1" },
      },
      turnId: "turn-1",
      createdAt: 1100,
    });
    ev(store, {
      agentId: "muse",
      kind: "tool_call.start",
      payload: {
        kind: "tool_call.start",
        id: "w2",
        name: "edit_file",
        input: { file_path: "notes.md" },
      },
      turnId: "turn-1",
      createdAt: 1200,
    });
    // A read does not produce anything.
    ev(store, {
      agentId: "muse",
      kind: "tool_call.start",
      payload: {
        kind: "tool_call.start",
        id: "r1",
        name: "read_file",
        input: { file_path: "notes.md" },
      },
      turnId: "turn-1",
      createdAt: 1300,
    });

    const turn = activityOf(projector, "muse").current!;
    expect(turn.produced).toEqual([{ path: "notes.md", toolCallId: "w2" }]);
  });

  it("nests subagent steps one level under the parent card", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [1], chainId: "user-1", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: { kind: "tool_call.start", id: "parent", name: "task", input: {} },
      turnId: "turn-1",
      createdAt: 1100,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: {
        kind: "tool_call.start",
        id: "child",
        name: "search_web",
        input: {},
        ns: ["task:abc"],
      },
      turnId: "turn-1",
      createdAt: 1200,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.end",
      payload: {
        kind: "tool_call.end",
        id: "child",
        name: "search_web",
        output: "ok",
        ns: ["task:abc"],
      },
      turnId: "turn-1",
      createdAt: 1400,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.end",
      payload: { kind: "tool_call.end", id: "parent", name: "task", output: "done" },
      turnId: "turn-1",
      createdAt: 1500,
    });

    const turn = activityOf(projector, "scout").current!;
    expect(turn.toolCalls).toHaveLength(1);
    const parent = turn.toolCalls[0];
    expect(parent.id).toBe("parent");
    expect(parent.status).toBe("done");
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toMatchObject({
      id: "child",
      status: "done",
      durationMs: 200,
    });
  });

  it("marks open cards interrupted when the turn is cancelled", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [1], chainId: "user-1", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: { kind: "tool_call.start", id: "c1", name: "search_web", input: {} },
      turnId: "turn-1",
      createdAt: 1100,
    });
    ev(store, {
      agentId: "scout",
      kind: "turn.end",
      payload: { kind: "turn.end", reason: "cancelled" },
      turnId: "turn-1",
      createdAt: 1500,
    });

    const activity = activityOf(projector, "scout");
    expect(activity.current).toBeNull();
    const turn = activity.recent[0];
    expect(turn.outcome).toBe("cancelled");
    expect(turn.toolCalls[0].status).toBe("interrupted");
    expect(turn.toolCalls[0].durationMs).toBe(400);
  });

  it("marks the current task failed on failure events", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [1], chainId: "user-1", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: { kind: "tool_call.start", id: "c1", name: "search_web", input: {} },
      turnId: "turn-1",
      createdAt: 1100,
    });
    ev(store, {
      agentId: "scout",
      kind: "failure",
      payload: { kind: "crash", message: "boom", at: 1400, retryable: true },
      turnId: "turn-1",
      createdAt: 1400,
    });

    const activity = activityOf(projector, "scout");
    expect(activity.current).toBeNull();
    const turn = activity.recent[0];
    expect(turn.outcome).toBe("failed");
    expect(turn.toolCalls[0].status).toBe("error");
  });

  it("replays the persisted log without duplicating state after a reload", () => {
    const store = makeStore();
    const first = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [1], chainId: "user-1", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "tool_call.start",
      payload: { kind: "tool_call.start", id: "c1", name: "search_web", input: {} },
      turnId: "turn-1",
      createdAt: 1100,
    });

    // Simulate a main-process restart: a fresh projector folds the same log.
    const snapshotBefore = first.getSnapshot();
    first.dispose();
    const replayed = new ActivityProjector({ store });
    projectors.push(replayed);

    expect(replayed.getSnapshot()).toEqual(snapshotBefore);
    const turn = activityOf(replayed, "scout").current!;
    expect(turn.toolCalls).toHaveLength(1);

    // New events fold exactly once on top of the replayed state.
    const listener = vi.fn();
    replayed.subscribe(listener);
    ev(store, {
      agentId: "scout",
      kind: "tool_call.end",
      payload: { kind: "tool_call.end", id: "c1", name: "search_web", output: "ok" },
      turnId: "turn-1",
      createdAt: 1200,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const [, activity, eventSeq] = listener.mock.calls[0];
    expect(activity.agentId).toBe("scout");
    expect(eventSeq).toBe(replayed.getSnapshot().highWaterSeq);
    expect(activityOf(replayed, "scout").current!.toolCalls[0].status).toBe("done");
  });

  it("bounds retained completed turns per agent, newest first", () => {
    const store = makeStore();
    const projector = makeProjector(store, { maxRecentTurns: 2 });

    for (let i = 1; i <= 3; i++) {
      ev(store, {
        agentId: "scout",
        kind: "turn.begin",
        payload: { triggerSeqs: [i], chainId: `user-${i}`, depth: 1 },
        turnId: `turn-${i}`,
        createdAt: i * 1000,
      });
      ev(store, {
        agentId: "scout",
        kind: "turn.end",
        payload: { kind: "turn.end", reason: "done" },
        turnId: `turn-${i}`,
        createdAt: i * 1000 + 500,
      });
    }

    const activity = activityOf(projector, "scout");
    expect(activity.recent.map((t) => t.turnId)).toEqual(["turn-3", "turn-2"]);
  });

  it("ignores token/status events for cards but tracks liveness", () => {
    const store = makeStore();
    const projector = makeProjector(store);

    ev(store, {
      agentId: "scout",
      kind: "turn.begin",
      payload: { triggerSeqs: [1], chainId: "user-1", depth: 1 },
      turnId: "turn-1",
      createdAt: 1000,
    });
    ev(store, {
      agentId: "scout",
      kind: "token",
      payload: { kind: "token", text: "hi" },
      turnId: "turn-1",
      createdAt: 1100,
    });
    ev(store, {
      agentId: "scout",
      kind: "status",
      payload: { kind: "status", phase: "thinking" },
      turnId: "turn-1",
      createdAt: 1150,
    });

    const activity = activityOf(projector, "scout");
    expect(activity.current!.toolCalls).toHaveLength(0);
    expect(activity.lastActiveAt).toBe(1150);
  });
});
