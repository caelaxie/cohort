import { afterEach, describe, expect, it } from "vitest";

import { createRoomAgent } from "../agents/agent-factory";
import { StubChatModel } from "../agents/stub-model";
import { RoomHost } from "../room-host";
import type { RoomPushEvent } from "../../shared/room-types";

describe("RoomHost", () => {
  const hosts: RoomHost[] = [];

  afterEach(async () => {
    for (const host of hosts.splice(0)) {
      await host.sessions.shutdown();
      host.dispose();
      host.store.close();
    }
  });

  function makeHost(scriptTokens: string[] = ["Hi ", "there"]): RoomHost {
    const host = new RoomHost({
      roomDbPath: ":memory:",
      sessionOptions: {
        factory: (config) =>
          createRoomAgent({
            model: new StubChatModel({
              script: [{ tokens: scriptTokens, tokenDelayMs: 5 }],
            }),
            name: config.name,
          }),
      },
    });
    hosts.push(host);
    return host;
  }

  it("snapshots history and pushes tokens/presence/messages for a live turn", async () => {
    const host = makeHost(["Hi ", "there"]);
    const events: RoomPushEvent[] = [];
    host.subscribe((e) => events.push(e));

    await host.broker.addAgent({
      id: "scout",
      name: "Scout",
      persona: "researcher",
    });

    const snap = host.getSnapshot();
    expect(snap.members.some((m) => m.id === "scout")).toBe(true);

    await host.postMessage("@Scout hello");
    await host.broker.idle();

    const kinds = new Set(events.map((e) => e.type));
    expect(kinds.has("token")).toBe(true);
    expect(kinds.has("message")).toBe(true);
    expect(kinds.has("presence")).toBe(true);

    const messages = host.store.listMessages();
    expect(messages.some((m) => m.authorType === "user")).toBe(true);
    expect(
      messages.some((m) => m.authorType === "agent" && m.text.includes("Hi")),
    ).toBe(true);
  });

  it("persists interrupted partials when a turn is cancelled", async () => {
    const host = makeHost(["par", "tial", " answer that keeps going"]);
    // Slow tokens so cancel can land mid-stream.
    await host.broker.addAgent({
      id: "scout",
      name: "Scout",
      persona: "researcher",
    });

    // Replace the agent with a slower script after add — easier: recreate host.
    hosts.pop();
    await host.sessions.shutdown();
    host.dispose();
    host.store.close();

    const slow = new RoomHost({
      roomDbPath: ":memory:",
      sessionOptions: {
        factory: (config) =>
          createRoomAgent({
            model: new StubChatModel({
              script: [
                {
                  tokens: ["partial…", " more", " text"],
                  tokenDelayMs: 80,
                },
              ],
            }),
            name: config.name,
          }),
      },
    });
    hosts.push(slow);

    await slow.broker.addAgent({
      id: "scout",
      name: "Scout",
      persona: "researcher",
    });

    const postPromise = slow.postMessage("@Scout work");
    // Wait until at least one token has been buffered via events.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("no token")), 3000);
      const unsub = slow.subscribe((e) => {
        if (e.type === "token") {
          clearTimeout(timeout);
          unsub();
          resolve();
        }
      });
    });

    expect(slow.cancelTurn("scout")).toBe(true);
    await postPromise;
    await slow.broker.idle();

    const agentMsgs = slow.store
      .listMessages()
      .filter((m) => m.authorType === "agent");
    expect(agentMsgs.length).toBeGreaterThanOrEqual(1);
    expect(agentMsgs.some((m) => m.interrupted && m.text.length > 0)).toBe(true);
    expect(
      slow.store
        .listMessages()
        .some((m) => m.authorType === "system" && /Interrupted/i.test(m.text)),
    ).toBe(true);
  });

  it("projects rail activity from a live stub-model turn (U7 × U5 seam)", async () => {
    const host = new RoomHost({
      roomDbPath: ":memory:",
      sessionOptions: {
        factory: (config) =>
          createRoomAgent({
            model: new StubChatModel({
              script: [
                {
                  tokens: ["On it."],
                  toolCalls: [
                    { name: "write_file", args: { file_path: "notes.md", content: "x" }, id: "w1" },
                  ],
                },
                { tokens: ["Done — wrote notes.md"] },
              ],
            }),
            name: config.name,
          }),
      },
    });
    hosts.push(host);
    const events: RoomPushEvent[] = [];
    host.subscribe((e) => events.push(e));
    await host.broker.addAgent({ id: "muse", name: "Muse", persona: "writer" });

    const { seq } = await host.postMessage("@Muse write me notes");
    await host.broker.idle();

    const snapshot = host.getActivitySnapshot();
    expect(snapshot.highWaterSeq).toBeGreaterThan(0);
    const muse = snapshot.activities.find((a) => a.agentId === "muse");
    expect(muse).toBeDefined();
    expect(muse!.current).toBeNull();
    expect(muse!.recent).toHaveLength(1);
    const turn = muse!.recent[0];
    expect(turn.outcome).toBe("done");
    expect(turn.originSeqs).toContain(seq);
    const write = turn.toolCalls.find((c) => c.name === "write_file");
    expect(write).toBeDefined();
    expect(write!.status).toBe("done");
    expect(write!.output).toBeDefined();
    expect(write!.durationMs).toBeGreaterThanOrEqual(0);
    expect(turn.produced).toEqual([{ path: "notes.md", toolCallId: "w1" }]);

    // Live activity pushes flowed while the turn ran.
    expect(events.some((e) => e.type === "activity" && e.agentId === "muse")).toBe(true);
  });
});
