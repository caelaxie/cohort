import { describe, expect, it, vi } from "vitest";
import { AIMessageChunk } from "@langchain/core/messages";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

import { StubChatModel, type StubReply } from "../stub-model";

type NewTokenCall = {
  token: string;
  chunkMessage?: AIMessageChunk;
};

/** Capture handleLLMNewToken calls the way LangGraph's messages handler sees them. */
function fakeRunManager() {
  const calls: NewTokenCall[] = [];
  const runManager = {
    handleLLMNewToken: vi.fn(
      async (
        token: string,
        _idx?: unknown,
        _runId?: string,
        _parentRunId?: string,
        _tags?: string[],
        fields?: { chunk?: { message: AIMessageChunk } },
      ) => {
        calls.push({ token, chunkMessage: fields?.chunk?.message });
      },
    ),
  };
  return {
    calls,
    runManager: runManager as unknown as CallbackManagerForLLMRun,
  };
}

async function generate(model: StubChatModel) {
  const { calls, runManager } = fakeRunManager();
  const result = await model._generate([], {} as never, runManager);
  return { calls, result };
}

describe("StubChatModel", () => {
  it("emits scripted tokens through the run manager and returns the full message", async () => {
    const model = new StubChatModel({
      script: [{ tokens: ["he", "llo"] }],
    });

    const { calls, result } = await generate(model);

    expect(calls.map((c) => c.token)).toEqual(["he", "llo"]);
    expect(calls[0].chunkMessage).toBeInstanceOf(AIMessageChunk);
    const message = result.generations[0].message;
    expect(message.content).toBe("hello");
  });

  it("emits tool-call args chunked when chunkToolCallArgs > 1 and attaches full tool_calls", async () => {
    const script: StubReply[] = [
      {
        toolCalls: [
          { name: "echo", args: { text: "hello world" }, id: "call-1" },
        ],
        chunkToolCallArgs: 4,
      },
    ];
    const model = new StubChatModel({ script });

    const { calls, result } = await generate(model);

    const fragments: string[] = [];
    let sawName = false;
    for (const call of calls) {
      const chunks = call.chunkMessage?.tool_call_chunks ?? [];
      for (const c of chunks) {
        if (c.name) sawName = true;
        if (c.args) fragments.push(c.args);
      }
    }
    expect(sawName).toBe(true);
    expect(fragments.length).toBeGreaterThan(1);
    expect(JSON.parse(fragments.join(""))).toEqual({ text: "hello world" });

    const message = result.generations[0].message;
    expect("tool_calls" in message && message.tool_calls).toEqual([
      { name: "echo", args: { text: "hello world" }, id: "call-1", type: "tool_call" },
    ]);
  });

  it("rejects when the script is exhausted", async () => {
    const model = new StubChatModel({ script: [{ tokens: ["only"] }] });
    await generate(model);
    await expect(generate(model)).rejects.toThrow(/script exhausted/);
  });

  it("throws the scripted error after emitting tokens (mid-stream failure)", async () => {
    const model = new StubChatModel({
      script: [{ tokens: ["partial"], error: new Error("boom") }],
    });

    const { calls, runManager } = fakeRunManager();
    await expect(model._generate([], {} as never, runManager)).rejects.toThrow(
      "boom",
    );
    expect(calls.map((c) => c.token)).toEqual(["partial"]);
  });

  it("supports string errors", async () => {
    const model = new StubChatModel({ script: [{ error: "nope" }] });
    await expect(generate(model)).rejects.toThrow("nope");
  });

  it("aborts between tokens when the signal fires", async () => {
    const controller = new AbortController();
    const model = new StubChatModel({
      script: [
        { tokens: ["a", "b", "c", "d"], tokenDelayMs: 5 },
      ],
    });
    const { runManager } = fakeRunManager();
    setTimeout(() => controller.abort(), 8);
    await expect(
      model._generate(
        [],
        { signal: controller.signal } as never,
        runManager,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bindTools returns a runnable (itself)", () => {
    const model = new StubChatModel({ script: [] });
    expect(model.bindTools()).toBe(model);
  });
});
