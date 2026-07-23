/**
 * Room context: ties the broker's room-context envelope into the
 * invocation path so live turns and replayed messages get identical framing —
 * the member roster and author-attributed "Name: message" lines, with missed
 * messages marked under `MISSED_MARKER`.
 *
 * The envelope builder itself lives in `src/main/broker.ts`; this module
 * re-exports it and adds the replay seam: missed messages are injected into an
 * agent's checkpointed history so the agent "sees" what happened while it was
 * away, framed by the same envelope.
 */
import type { BaseMessageLike } from "@langchain/core/messages";

import {
  buildRoomContext,
  MISSED_MARKER,
  type EnvelopeMessage,
  type RoomContextEnvelopeInput,
} from "../broker";
import type { RoomAgent } from "./agent-factory";

export {
  buildRoomContext,
  MISSED_MARKER,
  type EnvelopeMessage,
  type RoomContextEnvelopeInput,
};

/**
 * Build the invocation input for a turn: the room-context envelope as a
 * single user message. Used for live turns and replay alike.
 */
export function buildRoomContextInput(
  input: RoomContextEnvelopeInput,
): BaseMessageLike[] {
  return [{ role: "user", content: buildRoomContext(input) }];
}

export type InjectMessagesResult =
  | {
      /** Messages were written into the checkpointed thread state directly. */
      mode: "updateState";
    }
  | {
      /**
       * The SDK refused the state update; the caller must fold `messages`
       * into the agent's next invocation input instead (plan-sanctioned
       * fallback — the agent still sees the envelope, just one turn later).
       */
      mode: "fold-into-next-turn";
      messages: BaseMessageLike[];
      error: string;
    };

/**
 * Inject missed room messages into an agent's thread WITHOUT generating a
 * reply: the messages land in checkpointed history so the agent's next turn
 * starts aware of them.
 *
 * Uses LangGraph's `updateState`, which is typed `@internal` (`never`) on the
 * ReactAgent surface — hence the cast. If the SDK rejects the update, the
 * result tells the caller to fold the messages into the next turn input.
 */
export async function injectMessages(
  agent: RoomAgent,
  config: { configurable: { thread_id: string } },
  messages: BaseMessageLike[],
): Promise<InjectMessagesResult> {
  if (messages.length === 0) return { mode: "updateState" };
  try {
    const internal = agent as unknown as {
      updateState: (
        config: unknown,
        values: { messages: BaseMessageLike[] },
      ) => Promise<unknown>;
    };
    await internal.updateState(config, { messages });
    return { mode: "updateState" };
  } catch (err) {
    return {
      mode: "fold-into-next-turn",
      messages,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
