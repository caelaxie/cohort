/**
 * Stub chat model: a deterministic `BaseChatModel` that plays back a
 * script of replies. It makes every downstream behavior — token streaming,
 * chunked tool-call arguments, cancellation, and mid-stream errors — testable
 * without an LLM.
 *
 * How it works with the pinned SDK:
 * - `createDeepAgent` accepts a `BaseChatModel` instance as `model` (see
 *   `CreateDeepAgentParams.model`), so the stub is wired straight through the
 *   factory — no graph wrapping needed.
 * - The agent's model node calls `model.invoke(...)`. The stub implements the
 *   abstract `_generate` and emits each scripted token through the run
 *   manager's `handleLLMNewToken`, which is exactly what LangGraph's
 *   `streamMode: "messages"` handler listens to. Tool-call argument fragments
 *   are emitted the same way, wrapped in `ChatGenerationChunk`s carrying
 *   `AIMessageChunk.tool_call_chunks`, so chunked-args reassembly is
 *   exercised through the real streaming path.
 * - `bindTools` returns `this`: the stub ignores tool schemas; its scripted
 *   `tool_calls` on the final `AIMessage` drive the agent loop.
 */
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ToolCall, ToolCallChunk } from "@langchain/core/messages/tool";
import {
  ChatGenerationChunk,
  type ChatResult,
} from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";

/** A tool call the stub should place on its completed `AIMessage`. */
export interface StubToolCallSpec {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/** One scripted model reply. Each call to the model consumes one reply. */
export interface StubReply {
  /** Text tokens emitted one-by-one through the messages stream. */
  tokens?: string[];
  /**
   * Tool calls attached to the completed `AIMessage`. Presence of tool calls
   * is what routes the agent loop into the tools node.
   */
  toolCalls?: StubToolCallSpec[];
  /**
   * When > 1, each tool call's JSON-serialized args are also emitted through
   * the messages stream split into this many `tool_call_chunks` fragments,
   * simulating providers that stream arguments incrementally.
   */
  chunkToolCallArgs?: number;
  /** Delay between token emissions, in ms. Honors the abort signal. */
  tokenDelayMs?: number;
  /** Throw this error after the scripted emissions (mid-stream failure). */
  error?: Error | string;
}

export interface StubChatModelFields extends BaseChatModelParams {
  /** Ordered replies consumed one per model invocation. */
  script: StubReply[];
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function splitInto(s: string, n: number): string[] {
  if (n <= 1 || s.length === 0) return [s];
  const size = Math.ceil(s.length / n);
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

export class StubChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  private readonly replies: StubReply[];

  constructor(fields: StubChatModelFields) {
    const { script, ...rest } = fields;
    super(rest);
    this.replies = [...script];
  }

  _llmType(): string {
    return "stub-chat-model";
  }

  /**
   * The stub does not read tool schemas — scripted `tool_calls` decide what
   * the agent loop executes. Returning `this` satisfies the bind-tools
   * contract LangChain's agent node expects.
   */
  bindTools(): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    return this;
  }

  async _generate(
    _messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const reply = this.replies.shift();
    if (!reply) {
      throw new Error("StubChatModel script exhausted: no scripted reply left");
    }
    const signal = options?.signal;
    const tokens = reply.tokens ?? [];
    const toolCalls: ToolCall[] = (reply.toolCalls ?? []).map((tc, i) => ({
      name: tc.name,
      args: tc.args,
      id: tc.id ?? `call_${i}`,
      type: "tool_call",
    }));

    const emitChunk = async (message: AIMessageChunk, text: string) => {
      await runManager?.handleLLMNewToken(
        text,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          chunk: new ChatGenerationChunk({ message, text }),
        },
      );
    };

    for (const token of tokens) {
      if (signal?.aborted) throw abortError();
      if (reply.tokenDelayMs) await sleep(reply.tokenDelayMs, signal);
      await emitChunk(new AIMessageChunk({ content: token }), token);
    }

    if (reply.chunkToolCallArgs && reply.chunkToolCallArgs > 1) {
      for (const [index, tc] of toolCalls.entries()) {
        const fragments = splitInto(
          JSON.stringify(tc.args),
          reply.chunkToolCallArgs,
        );
        for (const [i, argsFragment] of fragments.entries()) {
          const chunk: ToolCallChunk = {
            index,
            args: argsFragment,
            ...(i === 0 ? { name: tc.name, id: tc.id } : {}),
          };
          await emitChunk(
            new AIMessageChunk({ content: "", tool_call_chunks: [chunk] }),
            "",
          );
        }
      }
    }

    if (reply.error) {
      throw typeof reply.error === "string"
        ? new Error(reply.error)
        : reply.error;
    }

    const message = new AIMessage({
      content: tokens.join(""),
      tool_calls: toolCalls,
    });
    return {
      generations: [{ message, text: tokens.join("") }],
      llmOutput: {},
    };
  }
}
