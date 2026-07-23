import { useEffect, useMemo, useRef } from "react";

import type { MemberDto, RoomMessageDto } from "../../../shared/room-types";
import type { StreamingBubble } from "../lib/useRoomState";
import { MessageBubble, StreamingBubbleView } from "./MessageBubble";

export interface MessageListProps {
  messages: RoomMessageDto[];
  streams: Record<string, StreamingBubble>;
  members: MemberDto[];
  onStop: (agentId: string) => void;
  onRetry: (agentId: string) => void;
}

const ROW_ESTIMATE = 88;

/**
 * Lightweight virtualized list: only rows near the viewport are mounted.
 * Falls back to rendering everything when the list is short.
 */
export function MessageList(props: MessageListProps): React.JSX.Element {
  const { messages, streams, members, onStop, onRetry } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const streamEntries = useMemo(() => Object.values(streams), [streams]);

  // Failure banners attach to the latest system/agent context for that agent.
  const failureByAgent = useMemo(() => {
    const map = new Map<string, MemberDto>();
    for (const m of members) {
      if (m.lastFailure && (m.presence === "error" || m.presence === "offline")) {
        map.set(m.id, m);
      }
    }
    return map;
  }, [members]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = distance < 48;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streams]);

  const total = messages.length + streamEntries.length;
  const useVirtual = total > 40;

  return (
    <div className="message-list" ref={scrollerRef} data-testid="message-list" role="log">
      {useVirtual ? (
        <VirtualRows
          messages={messages}
          streamEntries={streamEntries}
          failureByAgent={failureByAgent}
          onStop={onStop}
          onRetry={onRetry}
        />
      ) : (
        <>
          {messages.map((m) => (
            <MessageBubble
              key={m.seq}
              message={m}
              onStop={
                m.authorType === "agent" ? () => onStop(m.authorId) : undefined
              }
              onRetry={
                m.authorType === "system" || m.authorType === "agent"
                  ? () => {
                      // Prefer retrying the agent named in a failure member.
                      const agent = [...failureByAgent.values()][0];
                      if (agent) onRetry(agent.id);
                    }
                  : undefined
              }
              failureBanner={failureBannerFor(m, failureByAgent)}
            />
          ))}
          {streamEntries.map((s) => (
            <StreamingBubbleView
              key={`stream-${s.agentId}`}
              agentId={s.agentId}
              agentName={s.agentName}
              text={s.text}
              onStop={() => onStop(s.agentId)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function failureBannerFor(
  message: RoomMessageDto,
  failureByAgent: Map<string, MemberDto>,
): { kind: string; text: string; retryable: boolean } | null {
  if (message.authorType === "system") {
    // Match auth surface copy so the retry control can sit on the note.
    for (const member of failureByAgent.values()) {
      const f = member.lastFailure;
      if (!f) continue;
      if (f.kind === "auth" && message.text.includes("can't reach the model")) {
        return {
          kind: f.kind,
          text: message.text,
          retryable: f.retryable,
        };
      }
    }
  }
  if (message.authorType === "agent") {
    const member = failureByAgent.get(message.authorId);
    const f = member?.lastFailure;
    if (!f) return null;
    // Only decorate the latest agent message when they're still failed.
    return {
      kind: f.kind,
      text:
        f.kind === "auth"
          ? `${member!.name} can't reach the model — check the API key.`
          : `${member!.name} hit an error: ${f.message}.`,
      retryable: f.retryable,
    };
  }
  return null;
}

function VirtualRows(props: {
  messages: RoomMessageDto[];
  streamEntries: StreamingBubble[];
  failureByAgent: Map<string, MemberDto>;
  onStop: (agentId: string) => void;
  onRetry: (agentId: string) => void;
}): React.JSX.Element {
  const { messages, streamEntries, failureByAgent, onStop, onRetry } = props;
  const total = messages.length + streamEntries.length;
  const height = total * ROW_ESTIMATE;
  return (
    <div className="message-list-virtual" style={{ height }} data-testid="message-list-virtual">
      {messages.map((m, i) => (
        <div
          key={m.seq}
          className="message-list-row"
          style={{ top: i * ROW_ESTIMATE, height: ROW_ESTIMATE }}
        >
          <MessageBubble
            message={m}
            failureBanner={failureBannerFor(m, failureByAgent)}
            onRetry={() => {
              const agent = failureByAgent.get(m.authorId) ?? [...failureByAgent.values()][0];
              if (agent) onRetry(agent.id);
            }}
          />
        </div>
      ))}
      {streamEntries.map((s, i) => (
        <div
          key={`stream-${s.agentId}`}
          className="message-list-row"
          style={{ top: (messages.length + i) * ROW_ESTIMATE, height: ROW_ESTIMATE }}
        >
          <StreamingBubbleView
            agentId={s.agentId}
            agentName={s.agentName}
            text={s.text}
            onStop={() => onStop(s.agentId)}
          />
        </div>
      ))}
    </div>
  );
}
