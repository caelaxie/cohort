import type { MemberDto, PresenceState } from "../../../shared/room-types";

export interface MemberListProps {
  members: MemberDto[];
  onStop: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onNewAgent: () => void;
  onEditAgent?: (agentId: string) => void;
  onRemoveAgent?: (agentId: string) => void;
}

const PRESENCE_LABEL: Record<PresenceState, string> = {
  connecting: "connecting",
  idle: "idle",
  thinking: "thinking",
  runningTool: "running tool",
  error: "error",
  offline: "offline",
  stopped: "stopped",
};

function presenceClass(state: PresenceState): string {
  switch (state) {
    case "idle":
      return "dot-idle";
    case "thinking":
    case "runningTool":
    case "connecting":
      return "dot-busy";
    case "error":
      return "dot-error";
    case "offline":
    case "stopped":
      return "dot-offline";
    default:
      return "dot-idle";
  }
}

export function MemberList(props: MemberListProps): React.JSX.Element {
  const { members, onStop, onRetry, onNewAgent, onEditAgent, onRemoveAgent } = props;

  return (
    <aside className="member-list" data-testid="member-list" aria-label="Members">
      <div className="member-list-header">
        <h2>Members</h2>
        <button
          type="button"
          className="btn-primary btn-small"
          data-testid="new-agent"
          onClick={onNewAgent}
        >
          New agent
        </button>
      </div>
      <ul className="member-list-items">
        <li className="member-row member-user" data-testid="member-user">
          <span className={`presence-dot dot-idle`} aria-hidden />
          <div className="member-info">
            <div className="member-name">You</div>
            <div className="member-status">online</div>
          </div>
        </li>
        {members.map((m) => {
          const busy = m.presence === "thinking" || m.presence === "runningTool";
          const canRetry =
            (m.presence === "error" || m.presence === "offline") &&
            Boolean(m.lastFailure?.retryable);
          return (
            <li
              key={m.id}
              className="member-row"
              data-testid={`member-${m.id}`}
              data-presence={m.presence}
            >
              <span
                className={`presence-dot ${presenceClass(m.presence)}`}
                title={PRESENCE_LABEL[m.presence]}
                aria-label={PRESENCE_LABEL[m.presence]}
              />
              <div className="member-info">
                <div className="member-name">{m.name}</div>
                <div className="member-status" data-testid={`status-${m.id}`}>
                  {m.statusLine ?? PRESENCE_LABEL[m.presence]}
                </div>
              </div>
              <div className="member-actions">
                {busy ? (
                  <button
                    type="button"
                    className="btn-stop"
                    data-testid={`stop-${m.id}`}
                    onClick={() => onStop(m.id)}
                  >
                    Stop
                  </button>
                ) : null}
                {canRetry ? (
                  <button
                    type="button"
                    className="btn-link"
                    data-testid={`retry-${m.id}`}
                    onClick={() => onRetry(m.id)}
                  >
                    Retry
                  </button>
                ) : null}
                {onEditAgent ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    data-testid={`edit-${m.id}`}
                    onClick={() => onEditAgent(m.id)}
                  >
                    Edit
                  </button>
                ) : null}
                {onRemoveAgent ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    data-testid={`remove-${m.id}`}
                    onClick={() => onRemoveAgent(m.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
