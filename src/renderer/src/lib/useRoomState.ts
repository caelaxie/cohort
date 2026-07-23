/**
 * Room state hook: hydrates from a RoomClient snapshot and folds live push
 * events. Streaming tokens buffer per agent and flush once per animation
 * frame so the list never re-renders per token.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  MemberDto,
  RoomClient,
  RoomMessageDto,
  RoomPushEvent,
} from "../../../shared/room-types";

export interface StreamingBubble {
  agentId: string;
  agentName: string;
  text: string;
}

export interface RoomViewState {
  ready: boolean;
  messages: RoomMessageDto[];
  members: MemberDto[];
  streams: Record<string, StreamingBubble>;
  sendError: string | null;
  sending: boolean;
}

type Action =
  | { type: "hydrate"; messages: RoomMessageDto[]; members: MemberDto[] }
  | { type: "message"; message: RoomMessageDto }
  | { type: "members"; members: MemberDto[] }
  | { type: "presence"; member: MemberDto }
  | { type: "stream-flush"; streams: Record<string, StreamingBubble> }
  | { type: "stream-end"; agentId: string }
  | { type: "failure"; agentId: string; failure: MemberDto["lastFailure"] }
  | { type: "send-start" }
  | { type: "send-ok" }
  | { type: "send-fail"; error: string };

function upsertMessage(
  messages: RoomMessageDto[],
  message: RoomMessageDto,
): RoomMessageDto[] {
  const idx = messages.findIndex((m) => m.seq === message.seq);
  if (idx >= 0) {
    const next = messages.slice();
    next[idx] = message;
    return next;
  }
  // Insert in seq order.
  const next = messages.concat(message);
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

function reducer(state: RoomViewState, action: Action): RoomViewState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        ready: true,
        messages: action.messages,
        members: action.members,
      };
    case "message":
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
        // Final message supersedes any in-flight stream for that agent.
        streams:
          action.message.authorType === "agent"
            ? omitStream(state.streams, action.message.authorId)
            : state.streams,
      };
    case "members":
      return { ...state, members: action.members };
    case "presence": {
      const members = state.members.map((m) =>
        m.id === action.member.id ? action.member : m,
      );
      if (!members.some((m) => m.id === action.member.id)) {
        members.push(action.member);
      }
      return { ...state, members };
    }
    case "stream-flush":
      return { ...state, streams: action.streams };
    case "stream-end":
      return { ...state, streams: omitStream(state.streams, action.agentId) };
    case "failure":
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === action.agentId ? { ...m, lastFailure: action.failure } : m,
        ),
      };
    case "send-start":
      return { ...state, sending: true, sendError: null };
    case "send-ok":
      return { ...state, sending: false, sendError: null };
    case "send-fail":
      return { ...state, sending: false, sendError: action.error };
    default:
      return state;
  }
}

function omitStream(
  streams: Record<string, StreamingBubble>,
  agentId: string,
): Record<string, StreamingBubble> {
  if (!(agentId in streams)) return streams;
  const next = { ...streams };
  delete next[agentId];
  return next;
}

const initial: RoomViewState = {
  ready: false,
  messages: [],
  members: [],
  streams: {},
  sendError: null,
  sending: false,
};

export function useRoomState(client: RoomClient | null): {
  state: RoomViewState;
  postMessage: (text: string) => Promise<boolean>;
  cancelTurn: (agentId: string) => Promise<void>;
  retryAgent: (agentId: string) => Promise<void>;
} {
  const [state, dispatch] = useReducer(reducer, initial);
  const pendingTokens = useRef<Record<string, StreamingBubble>>({});
  const raf = useRef<number | null>(null);
  const streamsRef = useRef<Record<string, StreamingBubble>>({});

  const flushStreams = useCallback(() => {
    raf.current = null;
    const merged = { ...streamsRef.current };
    for (const [id, bubble] of Object.entries(pendingTokens.current)) {
      const prev = merged[id];
      merged[id] = prev
        ? { ...prev, text: prev.text + bubble.text }
        : bubble;
    }
    pendingTokens.current = {};
    streamsRef.current = merged;
    dispatch({ type: "stream-flush", streams: merged });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (raf.current !== null) return;
    // jsdom has no rAF — fall back to microtask so tests still coalesce.
    if (typeof requestAnimationFrame === "function") {
      raf.current = requestAnimationFrame(flushStreams);
    } else {
      raf.current = 1;
      queueMicrotask(() => {
        raf.current = null;
        flushStreams();
      });
    }
  }, [flushStreams]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.getSnapshot().then((snap) => {
      if (cancelled) return;
      dispatch({ type: "hydrate", messages: snap.messages, members: snap.members });
    });

    const unsub = client.subscribe((event: RoomPushEvent) => {
      switch (event.type) {
        case "message":
          // Drop any buffered stream tokens for this agent — final text won.
          if (event.message.authorType === "agent") {
            delete pendingTokens.current[event.message.authorId];
            streamsRef.current = omitStream(
              streamsRef.current,
              event.message.authorId,
            );
          }
          dispatch({ type: "message", message: event.message });
          break;
        case "members":
          dispatch({ type: "members", members: event.members });
          break;
        case "presence":
          dispatch({ type: "presence", member: event.member });
          break;
        case "token": {
          const existing = pendingTokens.current[event.agentId];
          pendingTokens.current[event.agentId] = {
            agentId: event.agentId,
            agentName: event.agentName,
            text: (existing?.text ?? "") + event.text,
          };
          scheduleFlush();
          break;
        }
        case "stream-end":
          delete pendingTokens.current[event.agentId];
          streamsRef.current = omitStream(streamsRef.current, event.agentId);
          dispatch({ type: "stream-end", agentId: event.agentId });
          break;
        case "failure":
          dispatch({
            type: "failure",
            agentId: event.agentId,
            failure: event.failure,
          });
          break;
      }
    });

    return () => {
      cancelled = true;
      unsub();
      if (raf.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf.current);
      }
      raf.current = null;
    };
  }, [client, scheduleFlush]);

  const postMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!client) return false;
      dispatch({ type: "send-start" });
      try {
        await client.postMessage(text);
        dispatch({ type: "send-ok" });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: "send-fail", error: message });
        return false;
      }
    },
    [client],
  );

  const cancelTurn = useCallback(
    async (agentId: string): Promise<void> => {
      if (!client) return;
      await client.cancelTurn(agentId);
    },
    [client],
  );

  const retryAgent = useCallback(
    async (agentId: string): Promise<void> => {
      if (!client) return;
      await client.retryAgent(agentId);
    },
    [client],
  );

  return { state, postMessage, cancelTurn, retryAgent };
}
