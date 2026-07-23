import { describe, expect, it, vi, type MockInstance } from "vitest";

import { createRoomAgent } from "../agents/agent-factory";
import { SessionManager } from "../agents/session-manager";
import { StubChatModel, type StubReply } from "../agents/stub-model";
import {
  Broker,
  buildRoomContext,
  MISSED_MARKER,
  type RelevanceGate,
} from "../broker";
import { firstMentionName, parseMentions, resolveMention } from "../mentions";
import { RoomStore } from "../room-store";

const SCOUT = { id: "scout", name: "Scout", persona: "Researches and verifies claims." };
const MUSE = { id: "muse", name: "Muse", persona: "Drafts vivid prose." };

interface Harness {
  store: RoomStore;
  sessions: SessionManager;
  broker: Broker;
  sendSpy: MockInstance<SessionManager["sendTurn"]>;
  /** Envelope text of every invocation, in call order. */
  envelopes: string[];
}

/**
 * Broker wired to a real SessionManager whose agents run on scripted stub
 * models — no live model calls anywhere. The sendTurn spy records the exact
 * invocation inputs and calls through to the real (bound) method.
 */
function makeHarness(options: {
  scripts?: Record<string, StubReply[]>;
  gate?: RelevanceGate;
}): Harness {
  const store = new RoomStore(":memory:");
  const sessions = new SessionManager({
    factory: (config) =>
      createRoomAgent({
        model: new StubChatModel({
          script: options.scripts?.[config.name ?? ""] ?? [{ tokens: ["ok"] }],
        }),
        name: config.name,
      }),
  });
  const broker = new Broker({ store, sessions, gate: options.gate });
  const realSend: SessionManager["sendTurn"] = sessions.sendTurn.bind(sessions);
  const envelopes: string[] = [];
  const sendSpy = vi
    .spyOn(sessions, "sendTurn")
    .mockImplementation(async (agentId, messages) => {
      envelopes.push(String((messages[0] as { content: unknown }).content));
      return realSend(agentId, messages);
    });
  return { store, sessions, broker, sendSpy, envelopes };
}

async function addScoutAndMuse(broker: Broker): Promise<void> {
  await broker.addAgent(SCOUT);
  await broker.addAgent(MUSE);
}

function invokedAgents(h: Harness): string[] {
  return h.sendSpy.mock.calls.map((call) => call[0]);
}

function systemNotes(h: Harness): string[] {
  return h.store
    .listMessages()
    .filter((m) => m.authorType === "system")
    .map((m) => m.text);
}

describe("mentions", () => {
  it("parses @Name tokens and takes the first as the target", () => {
    expect(parseMentions("@Scout and @Muse look")).toEqual(["Scout", "Muse"]);
    expect(firstMentionName("@Scout and @Muse look")).toBe("Scout");
    expect(firstMentionName("no mention here")).toBeNull();
  });

  it("resolves names case-insensitively and unknown names to null", () => {
    const roster = [SCOUT, MUSE];
    expect(resolveMention("scout", roster)).toEqual(SCOUT);
    expect(resolveMention("MUSE", roster)).toEqual(MUSE);
    expect(resolveMention("Ghost", roster)).toBeNull();
  });
});

describe("buildRoomContext", () => {
  it("carries the roster, author attribution, and missed markers", () => {
    const envelope = buildRoomContext({
      selfName: "Muse",
      roster: [SCOUT, MUSE],
      messages: [
        { authorName: "User", text: "hello room" },
        { authorName: "Scout", text: "old finding", missed: true },
      ],
    });
    expect(envelope).toContain("You are Muse");
    expect(envelope).toContain("- Scout — Researches and verifies claims.");
    expect(envelope).toContain("User: hello room");
    expect(envelope).toContain(`Scout (${MISSED_MARKER}): old finding`);
  });
});

describe("Broker routing", () => {
  it("@mention invokes only the target; others record for replay", async () => {
    const h = makeHarness({
      scripts: { Scout: [{ tokens: ["Parsers are IO-bound."] }] },
    });
    await addScoutAndMuse(h.broker);

    await h.broker.postUserMessage("@Scout why is the parser slow?");
    await h.broker.idle();

    // Only Scout was invoked.
    expect(invokedAgents(h)).toEqual(["scout"]);
    // Scout's reply is in the room record, attributed to Scout.
    const replies = h.store.listMessages().filter((m) => m.authorType === "agent");
    expect(replies).toHaveLength(1);
    expect(replies[0].authorName).toBe("Scout");
    expect(replies[0].text).toBe("Parsers are IO-bound.");
    // The invocation carried the room-context envelope: roster + attribution.
    expect(h.envelopes[0]).toContain("- Muse — Drafts vivid prose.");
    expect(h.envelopes[0]).toContain("User: @Scout why is the parser slow?");
    // Muse stayed silent and has the message recorded for replay.
    expect(h.store.getMissedMessages("muse").map((m) => m.text)).toContain(
      "@Scout why is the parser slow?",
    );
  });

  it("unaddressed message chimes in only the gate-opted persona", async () => {
    const h = makeHarness({
      scripts: { Muse: [{ tokens: ["A door opens onto weather."] }] },
      gate: ({ agent }) => agent.name === "Muse",
    });
    await addScoutAndMuse(h.broker);

    await h.broker.postUserMessage("I need a vivid opening line for chapter two.");
    await h.broker.idle();

    expect(invokedAgents(h)).toEqual(["muse"]);
    const replies = h.store.listMessages().filter((m) => m.authorType === "agent");
    expect(replies.map((m) => m.authorName)).toEqual(["Muse"]);
    // Scout saw nothing live; the message waits for his next invocation.
    expect(h.store.getMissedMessages("scout").map((m) => m.text)).toContain(
      "I need a vivid opening line for chapter two.",
    );
  });

  it("user @mention of an unknown member is noted and delivered to nobody", async () => {
    const h = makeHarness({});
    await addScoutAndMuse(h.broker);

    await h.broker.postUserMessage("@Ghost are you there?");
    await h.broker.idle();

    expect(invokedAgents(h)).toEqual([]);
    expect(systemNotes(h).join("\n")).toContain('No room member named "Ghost"');
  });
});

describe("Broker chain budget", () => {
  it("caps agent→agent mention chains at depth 3 with a system note", async () => {
    const h = makeHarness({
      scripts: {
        Scout: [{ tokens: ["@Muse please check"] }, { tokens: ["@Muse once more"] }],
        Muse: [{ tokens: ["@Scout your turn"] }],
      },
    });
    await addScoutAndMuse(h.broker);

    const { chainId } = await h.broker.postUserMessage("@Scout start");
    await h.broker.idle();

    // Scout (d1) → Muse (d2) → Scout (d3) → refused.
    expect(invokedAgents(h)).toEqual(["scout", "muse", "scout"]);
    expect(h.broker.getChainDepth(chainId)).toBe(3);
    const notes = systemNotes(h);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("depth limit (3)");
    expect(notes[0]).toContain("@Muse was not invoked");
  });

  it("drops agent mentions of non-existent members with a note, consuming no budget", async () => {
    const h = makeHarness({
      scripts: { Scout: [{ tokens: ["@Ghost come look at this"] }] },
    });
    await addScoutAndMuse(h.broker);

    const { chainId } = await h.broker.postUserMessage("@Scout hi");
    await h.broker.idle();

    expect(invokedAgents(h)).toEqual(["scout"]);
    const notes = systemNotes(h);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("@Ghost");
    expect(notes[0]).toContain("no room member has that name");
    // The dropped mention did not advance the chain budget.
    expect(h.broker.getChainDepth(chainId)).toBe(1);
  });

  it("binds chains originating from a chime-in turn — chime-ins do not reset the cap", async () => {
    const h = makeHarness({
      scripts: {
        Muse: [{ tokens: ["@Scout verify this"] }, { tokens: ["@Scout final thanks"] }],
        Scout: [{ tokens: ["@Muse confirmed"] }],
      },
      gate: ({ agent }) => agent.name === "Muse",
    });
    await addScoutAndMuse(h.broker);

    const { chainId } = await h.broker.postUserMessage("someone check this draft");
    await h.broker.idle();

    // Chime-in (d1) → mention (d2) → mention (d3) → refused: the chime-in
    // turn started the same budget a mention turn would have.
    expect(invokedAgents(h)).toEqual(["muse", "scout", "muse"]);
    expect(h.broker.getChainDepth(chainId)).toBe(3);
    expect(systemNotes(h).join("\n")).toContain("depth limit (3)");
  });
});

describe("Broker FIFO", () => {
  it("burst: three rapid messages fold in order with no preemption", async () => {
    const h = makeHarness({
      scripts: { Scout: [{ tokens: ["reply-one"] }, { tokens: ["reply-two"] }] },
    });
    // Track per-agent concurrency on top of the harness spy to prove that
    // no turn is ever preempted by the next one.
    let active = 0;
    let maxActive = 0;
    const envelopes: string[] = [];
    const baseImpl = h.sendSpy.getMockImplementation()!;
    h.sendSpy.mockImplementation(async (agentId, messages) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      envelopes.push(String((messages[0] as { content: unknown }).content));
      try {
        return await baseImpl(agentId, messages);
      } finally {
        active -= 1;
      }
    });
    await addScoutAndMuse(h.broker);

    await Promise.all([
      h.broker.postUserMessage("@Scout first"),
      h.broker.postUserMessage("@Scout second"),
      h.broker.postUserMessage("@Scout third"),
    ]);
    await h.broker.idle();

    // Turn 1 ran with the first message; the other two arrived mid-turn and
    // folded into turn 2, delivered together and in order.
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]).toContain("User: @Scout first");
    expect(envelopes[0]).not.toContain("second");
    expect(envelopes[0]).not.toContain("third");
    expect(envelopes[1]).toContain("User: @Scout second");
    expect(envelopes[1]).toContain("User: @Scout third");
    expect(envelopes[1].indexOf("second")).toBeLessThan(envelopes[1].indexOf("third"));
    // Folded arrivals are current input, not missed replays.
    expect(envelopes[1]).not.toContain(MISSED_MARKER);
    // FIFO with no preemption: never two turns in flight for one agent.
    expect(maxActive).toBe(1);
  });

  it("replay: an away agent receives all missed messages marked as missed", async () => {
    const h = makeHarness({
      scripts: { Muse: [{ tokens: ["hi all"] }] },
      gate: () => false, // nobody chimes in; Muse is simply never invoked
    });
    await addScoutAndMuse(h.broker);

    for (let i = 1; i <= 5; i += 1) {
      await h.broker.postUserMessage(`note ${i}`);
    }
    expect(h.sendSpy).not.toHaveBeenCalled();

    await h.broker.postUserMessage("@Muse hello");
    await h.broker.idle();

    expect(invokedAgents(h)).toEqual(["muse"]);
    const envelope = h.envelopes[0];
    for (let i = 1; i <= 5; i += 1) {
      expect(envelope).toContain(`User (${MISSED_MARKER}): note ${i}`);
    }
    // The triggering mention itself is current, not a missed replay.
    expect(envelope).toContain("User: @Muse hello");
    expect(envelope).not.toContain(`User (${MISSED_MARKER}): @Muse hello`);
    // The watermark advanced past everything delivered.
    expect(h.store.getMissedMessages("muse")).toHaveLength(0);
  });
});

describe("Broker membership cap", () => {
  it("refuses a ninth agent with a clear reason", async () => {
    const h = makeHarness({});
    for (let i = 1; i <= 8; i += 1) {
      await h.broker.addAgent({ id: `a${i}`, name: `Agent${i}`, persona: `persona ${i}` });
    }
    await expect(
      h.broker.addAgent({ id: "a9", name: "Agent9", persona: "one too many" }),
    ).rejects.toThrow(/capped at 8 agents/);
    expect(h.store.countAgents()).toBe(8);
  });
});

describe("Broker cancellation", () => {
  it("cancelTurn passes through and records an interruption marker in the store", async () => {
    const h = makeHarness({
      // Slow tokens keep the turn in flight long enough to cancel.
      scripts: { Scout: [{ tokens: ["a", "b", "c"], tokenDelayMs: 50 }] },
    });
    await h.broker.addAgent(SCOUT);

    await h.broker.postUserMessage("@Scout slow task");
    await vi.waitFor(() => {
      expect(h.sessions.getPresence("scout")).toBe("thinking");
    });
    expect(h.broker.cancelTurn("scout")).toBe(true);
    await h.broker.idle();

    const markers = h.store
      .listMessages()
      .filter((m) => m.authorType === "system" && m.text.startsWith("Interrupted:"));
    expect(markers).toHaveLength(1);
    expect(markers[0].text).toContain("Scout");
  });
});
