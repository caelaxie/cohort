import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createRoomAgent, type RoomAgent } from "../agent-factory";
import { runTurn, type RoomEvent } from "../turn-runner";
import { StubChatModel, type StubReply } from "../stub-model";

const echoTool = tool(async ({ text }: { text: string }) => `echo:${text}`, {
  name: "echo",
  description: "Echo back the provided text.",
  schema: z.object({ text: z.string() }),
});

function makeAgent(script: StubReply[], name = "test-agent"): RoomAgent {
  return createRoomAgent({
    model: new StubChatModel({ script }),
    tools: [echoTool],
    name,
  });
}

const userMessage = [{ role: "user", content: "hi" }];

async function collect(
  events: AsyncIterable<RoomEvent>,
  onEvent?: (e: RoomEvent) => void,
): Promise<RoomEvent[]> {
  const out: RoomEvent[] = [];
  for await (const e of events) {
    out.push(e);
    onEvent?.(e);
  }
  return out;
}

function kinds(events: RoomEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe("runTurn", () => {
  it("happy path: tokens, tool-call events, and turn.end(done) in order", async () => {
    const agent = makeAgent([
      {
        tokens: ["Let me check."],
        toolCalls: [{ name: "echo", args: { text: "hi" }, id: "call-1" }],
      },
      { tokens: ["Done", "!"] },
    ]);

    const events = await collect(runTurn(agent, userMessage));

    const ks = kinds(events);
    // Status lifecycle: thinking -> running-tool -> thinking -> idle.
    const phases = events
      .filter((e) => e.kind === "status")
      .map((e) => (e.kind === "status" ? e.phase : ""));
    expect(phases[0]).toBe("thinking");
    expect(phases).toContain("running-tool");
    expect(phases.at(-1)).toBe("idle");

    // Tokens arrive after the first thinking status.
    expect(ks.indexOf("token")).toBeGreaterThan(ks.indexOf("status"));
    const tokenText = events
      .filter((e) => e.kind === "token")
      .map((e) => (e.kind === "token" ? e.text : ""))
      .join("");
    expect(tokenText).toContain("Let me check.");
    expect(tokenText).toContain("Done!");

    // Tool-call lifecycle: start before end, with complete input and output.
    const startIdx = ks.indexOf("tool_call.start");
    const endIdx = ks.indexOf("tool_call.end");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);

    const start = events[startIdx];
    expect(start).toMatchObject({
      kind: "tool_call.start",
      id: "call-1",
      name: "echo",
      input: { text: "hi" },
    });
    const end = events[endIdx];
    expect(end).toMatchObject({
      kind: "tool_call.end",
      id: "call-1",
      name: "echo",
    });
    expect(end.kind === "tool_call.end" && String(end.output)).toContain(
      "echo:hi",
    );

    // Exactly one terminal event, last, done.
    expect(events.at(-1)).toEqual({ kind: "turn.end", reason: "done" });
  });

  it("reassembles chunked tool-call args into a complete tool_call.start", async () => {
    const agent = makeAgent([
      {
        toolCalls: [
          { name: "echo", args: { text: "hello world" }, id: "call-chunked" },
        ],
        chunkToolCallArgs: 5,
      },
      { tokens: ["done"] },
    ]);

    const events = await collect(runTurn(agent, userMessage));

    const starts = events.filter((e) => e.kind === "tool_call.start");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      id: "call-chunked",
      name: "echo",
      input: { text: "hello world" },
    });
    expect(events.at(-1)).toEqual({ kind: "turn.end", reason: "done" });
  });

  it("cancel mid-stream closes with turn.end(cancelled)", async () => {
    const controller = new AbortController();
    const agent = makeAgent([
      {
        tokens: Array.from({ length: 100 }, (_, i) => `t${i} `),
        tokenDelayMs: 10,
      },
      { tokens: ["unreachable"] },
    ]);

    const events = await collect(
      runTurn(agent, userMessage, controller.signal),
      (e) => {
        if (e.kind === "token") controller.abort();
      },
    );

    expect(events.some((e) => e.kind === "token")).toBe(true);
    expect(events.at(-1)).toEqual({ kind: "turn.end", reason: "cancelled" });
  });

  it("model error mid-stream closes with turn.end(error) and the error attached", async () => {
    const agent = makeAgent([
      { tokens: ["partial"], error: new Error("boom") },
    ]);

    const events = await collect(runTurn(agent, userMessage));

    expect(events.some((e) => e.kind === "token")).toBe(true);
    const last = events.at(-1);
    expect(last?.kind).toBe("turn.end");
    expect(last).toMatchObject({ reason: "error" });
    expect(last?.kind === "turn.end" && last.error).toContain("boom");
  });

  it("two agents stream concurrently with no event cross-talk", async () => {
    const agentA = makeAgent([{ tokens: ["A-one ", "A-two"] }], "agent-a");
    const agentB = makeAgent(
      [
        {
          toolCalls: [{ name: "echo", args: { text: "b" }, id: "call-b" }],
        },
        { tokens: ["B-one"] },
      ],
      "agent-b",
    );

    const [eventsA, eventsB] = await Promise.all([
      collect(runTurn(agentA, userMessage)),
      collect(runTurn(agentB, userMessage)),
    ]);

    const tokensA = eventsA
      .filter((e) => e.kind === "token")
      .map((e) => (e.kind === "token" ? e.text : ""));
    expect(tokensA).toEqual(["A-one ", "A-two"]);
    expect(eventsA.some((e) => e.kind === "tool_call.start")).toBe(false);
    expect(eventsA.at(-1)).toEqual({ kind: "turn.end", reason: "done" });

    const tokensB = eventsB
      .filter((e) => e.kind === "token")
      .map((e) => (e.kind === "token" ? e.text : ""));
    expect(tokensB).toEqual(["B-one"]);
    expect(
      eventsB.some(
        (e) => e.kind === "tool_call.start" && e.name === "echo",
      ),
    ).toBe(true);
    expect(eventsB.at(-1)).toEqual({ kind: "turn.end", reason: "done" });
  });
});
