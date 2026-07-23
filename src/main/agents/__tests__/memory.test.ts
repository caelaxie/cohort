/**
 * Memory integration tests: persistent per-agent
 * checkpoints on `SqliteSaver`, stable thread ids, default summarization
 * with per-agent overrides, checkpoint corruption recovery, and missed
 * message replay injection. All model calls go through StubChatModel —
 * no live model anywhere.
 */
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import { describe, expect, it } from "vitest";

import {
  agentCheckpointPath,
  createRoomAgent,
  roomThreadId,
  validateAgentCheckpoint,
  type RoomAgent,
} from "../agent-factory";
import { StubChatModel, type StubReply } from "../stub-model";
import {
  buildRoomContextInput,
  injectMessages,
  MISSED_MARKER,
} from "../room-context";

/** A stub model that records the exact messages each model call received. */
class RecordingStub extends StubChatModel {
  readonly calls: BaseMessage[][] = [];

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"] & BaseChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push(messages);
    return super._generate(messages, options, runManager);
  }
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-room-u5-"));
}

function messageTexts(messages: BaseMessage[]): string[] {
  return messages.map((m) =>
    typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  );
}

/** Texts of the conversation messages only (the system prompt is excluded). */
function conversationTexts(messages: BaseMessage[]): string[] {
  return messageTexts(withoutSystem(messages));
}

/** Drop the system prompt from a recorded model call. */
function withoutSystem(messages: BaseMessage[]): BaseMessage[] {
  return messages.filter((m) => m._getType() !== "system");
}

async function getHistory(
  agent: RoomAgent,
  agentId: string,
): Promise<BaseMessage[]> {
  const internal = agent as unknown as {
    getState: (config: {
      configurable: { thread_id: string };
    }) => Promise<{ values: { messages: BaseMessage[] } }>;
  };
  const state = await internal.getState({
    configurable: { thread_id: roomThreadId(agentId) },
  });
  return state.values.messages ?? [];
}

function makeAgent(
  dir: string,
  id: string,
  model: StubChatModel,
  memory?: { summarization?: boolean; triggerMessages?: number; keepMessages?: number },
): RoomAgent {
  return createRoomAgent({ id, memoryDir: dir, model, memory, name: id });
}

describe("persistent memory", () => {
  it("a recreated agent resumes from the same checkpoint file", async () => {
    const dir = makeTmpDir();
    const first = makeAgent(
      dir,
      "scout",
      new StubChatModel({ script: [{ tokens: ["Noted: the parser is slow."] }] }),
    );
    await first.invoke({
      messages: [{ role: "user", content: "The parser is slow." }],
    });

    // Simulate app relaunch: a brand-new agent + checkpointer against the
    // same memory directory and agent id.
    const second = makeAgent(
      dir,
      "scout",
      new StubChatModel({ script: [{ tokens: ["unused"] }] }),
    );
    const history = await getHistory(second, "scout");
    const texts = messageTexts(history);

    expect(texts).toContain("The parser is slow.");
    expect(texts).toContain("Noted: the parser is slow.");
    // The recreated agent has not consumed its script — no new reply ran.
    expect(history).toHaveLength(2);
  });

  it("keeps per-agent checkpoints isolated in one memory dir", async () => {
    const dir = makeTmpDir();
    const a = makeAgent(dir, "a", new StubChatModel({ script: [{ tokens: ["A"] }] }));
    const b = makeAgent(dir, "b", new StubChatModel({ script: [{ tokens: ["B"] }] }));
    await a.invoke({ messages: [{ role: "user", content: "for a" }] });

    expect(await getHistory(a, "a")).toHaveLength(2);
    expect(await getHistory(b, "b")).toHaveLength(0);
    expect(existsSync(agentCheckpointPath(dir, "a"))).toBe(true);
    expect(existsSync(agentCheckpointPath(dir, "b"))).toBe(true);
  });
});

describe("summarization", () => {
  it("forced threshold summarizes old history and keeps recent turns verbatim", async () => {
    const dir = makeTmpDir();
    const model = new RecordingStub({
      script: [
        { tokens: ["answer one"] },
        { tokens: ["answer two"] },
        // The third turn crosses the trigger: the middleware first asks the
        // model for a summary, then runs the turn itself.
        { tokens: ["SUMMARY of earlier conversation"] },
        { tokens: ["answer three"] },
      ],
    });
    const agent = makeAgent(dir, "muse", model, {
      triggerMessages: 4,
      keepMessages: 2,
    });

    await agent.invoke({ messages: [{ role: "user", content: "turn one" }] });
    await agent.invoke({ messages: [{ role: "user", content: "turn two" }] });
    await agent.invoke({ messages: [{ role: "user", content: "turn three" }] });

    // Sanity: nothing summarized before the threshold (turn 2 saw all 3 msgs).
    expect(model.calls).toHaveLength(4);
    expect(conversationTexts(model.calls[1])).toEqual([
      "turn one",
      "answer one",
      "turn two",
    ]);

    // Call 3 is the summary request: one human prompt holding the old turns.
    expect(model.calls[2]).toHaveLength(1);
    expect(messageTexts(model.calls[2])[0]).toContain("turn one");

    // Call 4 is the real turn-3 model call with bounded context: the summary
    // message plus only the two most recent verbatim messages.
    const bounded = withoutSystem(model.calls[3]);
    expect(bounded).toHaveLength(3);
    expect(bounded[0].additional_kwargs?.lc_source).toBe("summarization");
    expect(messageTexts([bounded[0]])[0]).toContain(
      "SUMMARY of earlier conversation",
    );
    expect(messageTexts(bounded.slice(1))).toEqual(["answer two", "turn three"]);

    // The summarization event is checkpointed, so bounded context persists.
    const history = await getHistory(agent, "muse");
    expect(history.length).toBeGreaterThan(3); // full record survives
  });

  it("Override: summarization disabled keeps full verbatim context", async () => {
    const dir = makeTmpDir();
    const script: StubReply[] = [
      { tokens: ["a1"] },
      { tokens: ["a2"] },
      { tokens: ["a3"] },
    ];
    const verbatim = new RecordingStub({ script: [...script] });
    const summarizing = new RecordingStub({
      script: [...script.slice(0, 2), { tokens: ["SUM"] }, { tokens: ["a3"] }],
    });

    const verbatimAgent = makeAgent(dir, "verbatim", verbatim, {
      summarization: false,
    });
    const summarizingAgent = makeAgent(dir, "summarizing", summarizing, {
      triggerMessages: 4,
      keepMessages: 2,
    });

    for (const turn of ["t1", "t2", "t3"]) {
      await verbatimAgent.invoke({ messages: [{ role: "user", content: turn }] });
      await summarizingAgent.invoke({ messages: [{ role: "user", content: turn }] });
    }

    // Disabled: the final call saw every message verbatim, no summary call.
    expect(verbatim.calls).toHaveLength(3);
    expect(conversationTexts(verbatim.calls[2])).toEqual([
      "t1",
      "a1",
      "t2",
      "a2",
      "t3",
    ]);

    // Enabled: a summary call ran and the final call was bounded.
    expect(summarizing.calls).toHaveLength(4);
    expect(withoutSystem(summarizing.calls[3])).toHaveLength(3);
  });
});

describe("checkpoint validation", () => {
  it("healthy checkpoint passes with no notice", async () => {
    const dir = makeTmpDir();
    const agent = makeAgent(dir, "ok", new StubChatModel({ script: [{ tokens: ["hi"] }] }));
    await agent.invoke({ messages: [{ role: "user", content: "hello" }] });
    const notice = await validateAgentCheckpoint(agentCheckpointPath(dir, "ok"));
    expect(notice).toBeUndefined();
  });

  it("missing checkpoint file passes with no notice", async () => {
    const dir = makeTmpDir();
    const notice = await validateAgentCheckpoint(join(dir, "nope.sqlite"));
    expect(notice).toBeUndefined();
  });

  it("corrupt checkpoint is backed up, a fresh thread starts, and a notice is returned", async () => {
    const dir = makeTmpDir();
    const dbPath = agentCheckpointPath(dir, "muse");
    writeFileSync(dbPath, "this is not a sqlite database at all");

    const notice = await validateAgentCheckpoint(dbPath);
    expect(notice).toMatch(/corrupt/i);
    expect(notice).toMatch(/backed up/i);

    // Original moved aside; nothing was deleted.
    expect(existsSync(dbPath)).toBe(false);
    const backups = readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(backups).toHaveLength(1);

    // The agent starts fresh against a new DB at the original path.
    const agent = makeAgent(dir, "muse", new StubChatModel({ script: [{ tokens: ["fresh"] }] }));
    await agent.invoke({ messages: [{ role: "user", content: "start over" }] });
    const texts = messageTexts(await getHistory(agent, "muse"));
    expect(texts).toEqual(["start over", "fresh"]);
  });
});

describe("missed-message replay injection", () => {
  it("updateState injection lands messages in history with no generated reply", async () => {
    const dir = makeTmpDir();
    const model = new RecordingStub({ script: [{ tokens: ["reply"] }] });
    const agent = makeAgent(dir, "scribe", model);

    const missed = buildRoomContextInput({
      selfName: "Scribe",
      roster: [
        { name: "Scribe", persona: "takes notes" },
        { name: "Muse", persona: "brainstorms" },
      ],
      messages: [
        { authorName: "User", text: "while you were offline", missed: true },
        { authorName: "Muse", text: "an idea from Muse", missed: true },
      ],
    });

    const result = await injectMessages(
      agent,
      { configurable: { thread_id: roomThreadId("scribe") } },
      missed,
    );
    expect(result.mode).toBe("updateState");

    const history = await getHistory(agent, "scribe");
    expect(history).toHaveLength(1); // injected message only — no reply ran
    expect(model.calls).toHaveLength(0); // the model was never invoked

    // Attribution and the missed marker survive replay.
    const content = messageTexts(history)[0];
    expect(content).toContain("[Room roster]");
    expect(content).toContain("- Muse — brainstorms");
    expect(content).toContain(`User (${MISSED_MARKER}): while you were offline`);
    expect(content).toContain(`Muse (${MISSED_MARKER}): an idea from Muse`);

    // The injected context is visible to the agent's next turn.
    await agent.invoke({ messages: [{ role: "user", content: "caught up?" }] });
    const seen = messageTexts(model.calls[0]).join("\n");
    expect(seen).toContain("an idea from Muse");
    expect(seen).toContain("caught up?");
  });

  it("empty injection is a no-op", async () => {
    const dir = makeTmpDir();
    const agent = makeAgent(dir, "idle", new StubChatModel({ script: [] }));
    const result = await injectMessages(
      agent,
      { configurable: { thread_id: roomThreadId("idle") } },
      [],
    );
    expect(result.mode).toBe("updateState");
    expect(await getHistory(agent, "idle")).toHaveLength(0);
  });
});
