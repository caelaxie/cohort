import type { RoomClient } from "../../../shared/room-types";
import { useRoomState } from "../lib/useRoomState";
import { Composer } from "./Composer";
import { MemberList } from "./MemberList";
import { MessageList } from "./MessageList";

export interface RoomProps {
  client: RoomClient;
  /** Open the agent builder (U8 owns the full surface). */
  onOpenBuilder: () => void;
  onEditAgent?: (agentId: string) => void;
  onRemoveAgent?: (agentId: string) => void;
  /** Optional rail slot for U7. */
  rail?: React.ReactNode;
}

export function Room(props: RoomProps): React.JSX.Element {
  const { client, onOpenBuilder, onEditAgent, onRemoveAgent, rail } = props;
  const { state, postMessage, cancelTurn, retryAgent } = useRoomState(client);

  const hasAgents = state.members.length > 0;
  const composerDisabled = !hasAgents;

  return (
    <div className="room" data-testid="room">
      <MemberList
        members={state.members}
        onStop={(id) => void cancelTurn(id)}
        onRetry={(id) => void retryAgent(id)}
        onNewAgent={onOpenBuilder}
        onEditAgent={onEditAgent}
        onRemoveAgent={onRemoveAgent}
      />

      <section className="room-main">
        <header className="room-header">
          <h1>Agent Room</h1>
          {!state.ready ? <span className="room-loading">Loading…</span> : null}
        </header>

        {!hasAgents && state.ready ? (
          <div className="room-empty" data-testid="room-empty">
            <h2>No agents yet</h2>
            <p>Create an agent to start hanging out and working together.</p>
            <button
              type="button"
              className="btn-primary"
              data-testid="empty-create"
              onClick={onOpenBuilder}
            >
              Create an agent
            </button>
          </div>
        ) : (
          <MessageList
            messages={state.messages}
            streams={state.streams}
            members={state.members}
            onStop={(id) => void cancelTurn(id)}
            onRetry={(id) => void retryAgent(id)}
          />
        )}

        <Composer
          members={state.members}
          disabled={composerDisabled}
          sending={state.sending}
          sendError={state.sendError}
          onSend={postMessage}
        />
      </section>

      {rail ? <div className="room-rail">{rail}</div> : null}
    </div>
  );
}
