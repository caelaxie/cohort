import type { RoomMessageDto } from "../../../shared/room-types";
import { renderMarkdown } from "../lib/markdown";

export interface MessageBubbleProps {
  message: RoomMessageDto;
  /** True while this bubble is still streaming tokens. */
  streaming?: boolean;
  onStop?: () => void;
  onRetry?: () => void;
  /** Inline failure attached under an agent row (auth gets distinct copy). */
  failureBanner?: { kind: string; text: string; retryable: boolean } | null;
}

export function MessageBubble(props: MessageBubbleProps): React.JSX.Element {
  const { message, streaming, onStop, onRetry, failureBanner } = props;

  if (message.authorType === "system") {
    return (
      <div className="msg msg-system" data-testid={`msg-${message.seq}`} data-author="system">
        <div className="msg-system-text">{message.text}</div>
        {failureBanner?.retryable && onRetry ? (
          <button type="button" className="btn-link" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  const isUser = message.authorType === "user";
  return (
    <div
      className={`msg ${isUser ? "msg-user" : "msg-agent"}`}
      data-testid={`msg-${message.seq}`}
      data-author={message.authorId}
      data-streaming={streaming ? "true" : undefined}
      data-interrupted={message.interrupted ? "true" : undefined}
    >
      <div className="msg-meta">
        <span className="msg-author">{message.authorName}</span>
        {streaming ? <span className="msg-streaming-dot" aria-label="streaming" /> : null}
        {message.interrupted ? (
          <span className="msg-interrupted" data-testid={`interrupted-${message.seq}`}>
            interrupted
          </span>
        ) : null}
        {streaming && onStop ? (
          <button type="button" className="btn-stop" onClick={onStop} aria-label="Stop">
            Stop
          </button>
        ) : null}
      </div>
      <div className="msg-body">{renderMarkdown(message.text)}</div>
      {failureBanner ? (
        <div
          className={`msg-failure ${failureBanner.kind === "auth" ? "msg-failure-auth" : ""}`}
          data-testid={`failure-${message.authorId}`}
        >
          <span>{failureBanner.text}</span>
          {failureBanner.retryable && onRetry ? (
            <button type="button" className="btn-link" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface StreamingBubbleProps {
  agentId: string;
  agentName: string;
  text: string;
  onStop?: () => void;
}

export function StreamingBubbleView(props: StreamingBubbleProps): React.JSX.Element {
  return (
    <MessageBubble
      message={{
        id: -1,
        seq: Number.MAX_SAFE_INTEGER,
        authorType: "agent",
        authorId: props.agentId,
        authorName: props.agentName,
        text: props.text || "…",
        createdAt: Date.now(),
      }}
      streaming
      onStop={props.onStop}
    />
  );
}
