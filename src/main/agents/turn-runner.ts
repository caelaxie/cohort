/**
 * Turn runner: executes one agent turn in-process and maps
 * LangGraph stream chunks onto the room's `RoomEvent` contract.
 *
 * - Turns are plain in-process invocations; cancellation is an
 *   `AbortSignal` per turn — no wire protocol.
 * - Uses the STABLE streaming API only: `agent.stream` with
 *   `streamMode: ["updates", "messages"]` and `subgraphs: true`
 *   (KTD10 — the experimental `streamEvents` v3 API is not used).
 *
 * Mapping:
 * - `messages`-mode chunks from the chat model → `status(thinking)` +
 *   `token` events; `tool_call_chunks` fragments are reassembled by index
 *   so complete tool-call inputs survive chunked delivery.
 * - `updates`-mode node outputs → `tool_call.start` (finalized AI message
 *   with tool calls), `status(running-tool)` + `tool_call.end`
 *   (tool messages from the tools node).
 * - Stream completion → `turn.end(done)`; abort → `turn.end(cancelled)`;
 *   any other failure → `turn.end(error)` with the error attached.
 */
import {
  AIMessageChunk,
  isAIMessage,
  isToolMessage,
  type BaseMessage,
  type BaseMessageLike,
} from "@langchain/core/messages";

import type { RoomAgent } from "./agent-factory";

export type RoomStatusPhase = "thinking" | "running-tool" | "idle";

export type RoomEvent =
  | { kind: "token"; text: string }
  | { kind: "tool_call.start"; id: string; name: string; input: unknown; ns?: string[] }
  | {
      kind: "tool_call.end";
      id: string;
      name: string;
      output?: unknown;
      error?: string;
      ns?: string[];
    }
  | { kind: "status"; phase: RoomStatusPhase }
  | {
      kind: "turn.end";
      reason: "done" | "cancelled" | "error";
      error?: string;
    };

/** Accumulator for tool-call argument fragments keyed by chunk index. */
interface ArgReassembly {
  name?: string;
  id?: string;
  args: string;
}

interface ToolCallState {
  name: string;
  ended: boolean;
  /** Subgraph namespace the call started in (empty = top-level graph). */
  ns: string[];
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * Run one turn of `agent` against `messages`, yielding `RoomEvent`s as the
 * underlying graph streams. Pass an `AbortSignal` to cancel the turn;
 * aborting closes the stream with `turn.end(cancelled)`.
 *
 * The generator always terminates with exactly one `turn.end` event.
 */
export async function* runTurn(
  agent: RoomAgent,
  messages: BaseMessageLike[],
  signal?: AbortSignal,
): AsyncGenerator<RoomEvent> {
  const startedToolCalls = new Map<string, ToolCallState>();
  const argFragments = new Map<number, ArgReassembly>();
  let phase: RoomStatusPhase | undefined;

  function* setPhase(next: RoomStatusPhase): Generator<RoomEvent> {
    if (phase !== next) {
      phase = next;
      yield { kind: "status", phase: next };
    }
  }

  /** Look up reassembled args for a finalized tool call, if any were streamed. */
  const reassembledArgsFor = (tc: {
    id?: string;
    name: string;
  }): string | undefined => {
    for (const frag of argFragments.values()) {
      if ((tc.id && frag.id === tc.id) || frag.name === tc.name) {
        return frag.args;
      }
    }
    return undefined;
  };

  try {
    const stream = (await agent.stream(
      { messages },
      {
        streamMode: ["updates", "messages"],
        subgraphs: true,
        signal,
      },
    )) as AsyncIterable<unknown>;

    for await (const rawChunk of stream) {
      // With subgraphs:true and multiple stream modes, chunks are
      // [namespace, mode, payload] tuples.
      const [ns, mode, payload] = rawChunk as [string[], string, unknown];

      if (mode === "messages") {
        const [message] = payload as [unknown, unknown];
        if (message instanceof AIMessageChunk) {
          const text = textContent(message.content);
          const toolChunks = message.tool_call_chunks ?? [];
          if (text || toolChunks.length > 0) {
            yield* setPhase("thinking");
          }
          if (text) {
            yield { kind: "token", text };
          }
          for (const tc of toolChunks) {
            const index = tc.index ?? 0;
            const acc = argFragments.get(index) ?? { args: "" };
            if (tc.name) acc.name = tc.name;
            if (tc.id) acc.id = tc.id;
            if (typeof tc.args === "string") acc.args += tc.args;
            argFragments.set(index, acc);
          }
        }
      } else if (mode === "updates") {
        const updates = payload as Record<
          string,
          { messages?: BaseMessage[] } | undefined
        >;
        for (const nodeUpdate of Object.values(updates)) {
          const nodeMessages = nodeUpdate?.messages;
          if (!Array.isArray(nodeMessages)) continue;
          for (const m of nodeMessages) {
            if (isAIMessage(m) && m.tool_calls) {
              for (const tc of m.tool_calls) {
                const id = tc.id ?? `${tc.name}:${startedToolCalls.size}`;
                if (startedToolCalls.has(id)) continue;
                let input: unknown = tc.args;
                const raw = reassembledArgsFor(tc);
                if (raw) {
                  try {
                    input = JSON.parse(raw);
                  } catch {
                    // Reassembled args are not valid JSON; keep the
                    // finalized message args instead.
                  }
                }
                startedToolCalls.set(id, { name: tc.name, ended: false, ns });
                yield {
                  kind: "tool_call.start",
                  id,
                  name: tc.name,
                  input,
                  ...(ns.length > 0 ? { ns } : {}),
                };
              }
            } else if (isToolMessage(m)) {
              const id = m.tool_call_id;
              const state = startedToolCalls.get(id);
              if (state?.ended) continue;
              if (state) state.ended = true;
              const name = m.name ?? state?.name ?? "unknown";
              yield* setPhase("running-tool");
              const callNs = state?.ns ?? ns;
              if (m.status === "error") {
                yield {
                  kind: "tool_call.end",
                  id,
                  name,
                  error: textContent(m.content),
                  ...(callNs.length > 0 ? { ns: callNs } : {}),
                };
              } else {
                yield {
                  kind: "tool_call.end",
                  id,
                  name,
                  output: textContent(m.content),
                  ...(callNs.length > 0 ? { ns: callNs } : {}),
                };
              }
            }
          }
        }
      }
    }

    yield* setPhase("idle");
    if (signal?.aborted) {
      yield { kind: "turn.end", reason: "cancelled" };
    } else {
      yield { kind: "turn.end", reason: "done" };
    }
  } catch (err) {
    if (signal?.aborted || isAbortLike(err)) {
      yield { kind: "turn.end", reason: "cancelled" };
    } else {
      yield { kind: "turn.end", reason: "error", error: describeError(err) };
    }
  }
}
