import { useEffect, useState } from "react";

import type {
  AgentActivityDto,
  RoomClient,
  TurnActivityDto,
} from "../../../shared/room-types";
import { useActivityState } from "../lib/useActivityState";
import { formatDuration, ToolCallCard } from "./ToolCallCard";

/** "just now", "42s ago", "5m ago", "3h ago", "2d ago". */
export function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Ticking wall clock so running durations and idle ages stay live. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function defaultJumpToMessage(seq: number): void {
  const el = document.querySelector(`[data-testid="msg-${seq}"]`);
  if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
    (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

interface TurnViewProps {
  turn: TurnActivityDto;
  now: number;
  onJumpToMessage: (seq: number) => void;
}

function TurnView(props: TurnViewProps): React.JSX.Element {
  const { turn, now, onJumpToMessage } = props;
  return (
    <div className="rail-turn" data-testid={`rail-turn-${turn.turnId}`}>
      {turn.originSeqs.length > 0 ? (
        <div className="rail-origins">
          {turn.originSeqs.map((seq) => (
            <button
              key={seq}
              type="button"
              className="rail-origin"
              data-testid={`rail-origin-${seq}`}
              title="Jump to the message that started this"
              onClick={() => onJumpToMessage(seq)}
            >
              from msg #{seq}
            </button>
          ))}
        </div>
      ) : null}

      {turn.toolCalls.map((call) => (
        <ToolCallCard key={call.id} card={call} now={now} />
      ))}

      {turn.toolCalls.length === 0 && !turn.outcome ? (
        <div className="rail-turn-empty">working…</div>
      ) : null}
    </div>
  );
}

function TurnOutcomeMeta(props: { turn: TurnActivityDto }): React.JSX.Element {
  const { turn } = props;
  return (
    <div className="rail-recent-meta">
      <span className={`tool-chip tool-chip-${turn.outcome ?? "done"}`}>
        {turn.outcome ?? "done"}
      </span>
      {turn.endedAt !== undefined ? (
        <span className="tool-duration">
          {formatDuration(turn.endedAt - turn.startedAt)}
        </span>
      ) : null}
    </div>
  );
}

function RecentTurns(props: {
  agentId: string;
  turns: TurnActivityDto[];
  now: number;
  onJumpToMessage: (seq: number) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { agentId, turns, now, onJumpToMessage } = props;
  return (
    <details className="rail-recent" data-testid={`rail-recent-${agentId}`} open={open}>
      <summary
        data-testid={`rail-recent-toggle-${agentId}`}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        {turns.length} earlier turn{turns.length === 1 ? "" : "s"}
      </summary>
      {open
        ? turns.map((turn) => (
            <div key={turn.turnId} className="rail-recent-turn">
              <TurnOutcomeMeta turn={turn} />
              <TurnView turn={turn} now={now} onJumpToMessage={onJumpToMessage} />
            </div>
          ))
        : null}
    </details>
  );
}

function ProducedList(props: {
  agentId: string;
  items: { path: string; toolCallId: string }[];
}): React.JSX.Element {
  return (
    <div className="rail-produced" data-testid={`produced-${props.agentId}`}>
      <span className="rail-produced-label">produced</span>
      <ul>
        {props.items.map((item) => (
          <li key={item.path} className="rail-produced-item">
            {item.path}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentSection(props: {
  activity: AgentActivityDto;
  now: number;
  onJumpToMessage: (seq: number) => void;
}): React.JSX.Element {
  const { activity, now, onJumpToMessage } = props;
  // The just-settled turn stays visible (interrupted/failed chips must be
  // glanceable); older turns collapse behind the toggle.
  const latestSettled =
    !activity.current && activity.recent.length > 0 ? activity.recent[0] : null;
  const collapsedRecent = latestSettled ? activity.recent.slice(1) : activity.recent;
  return (
    <section className="rail-agent" data-testid={`rail-agent-${activity.agentId}`}>
      <h3 className="rail-agent-name">{activity.agentName}</h3>

      {activity.current ? (
        <TurnView turn={activity.current} now={now} onJumpToMessage={onJumpToMessage} />
      ) : (
        <div className="rail-idle" data-testid={`rail-idle-${activity.agentId}`}>
          idle
          {activity.lastActiveAt !== null
            ? ` — last active ${formatRelative(activity.lastActiveAt, now)}`
            : ""}
        </div>
      )}

      {activity.current && activity.current.produced.length > 0 ? (
        <ProducedList agentId={activity.agentId} items={activity.current.produced} />
      ) : null}

      {latestSettled ? (
        <div className="rail-last-turn" data-testid={`rail-last-${activity.agentId}`}>
          <TurnOutcomeMeta turn={latestSettled} />
          <TurnView turn={latestSettled} now={now} onJumpToMessage={onJumpToMessage} />
          {latestSettled.produced.length > 0 ? (
            <ProducedList agentId={activity.agentId} items={latestSettled.produced} />
          ) : null}
        </div>
      ) : null}

      {collapsedRecent.length > 0 ? (
        <RecentTurns
          agentId={activity.agentId}
          turns={collapsedRecent}
          now={now}
          onJumpToMessage={onJumpToMessage}
        />
      ) : null}
    </section>
  );
}

export interface ActivityRailProps {
  client: RoomClient;
  /** Override for the chat deep-link; defaults to scrolling to the message. */
  onJumpToMessage?: (seq: number) => void;
}

export function ActivityRail(props: ActivityRailProps): React.JSX.Element {
  const { client, onJumpToMessage = defaultJumpToMessage } = props;
  const { ready, activities } = useActivityState(client);
  const now = useNow();

  return (
    <aside className="activity-rail" data-testid="activity-rail">
      <h2 className="rail-title">Activity</h2>
      {!ready ? <div className="rail-loading">Loading…</div> : null}
      {ready && activities.length === 0 ? (
        <div className="rail-empty">No agents yet — activity shows up here.</div>
      ) : null}
      {activities.map((activity) => (
        <AgentSection
          key={activity.agentId}
          activity={activity}
          now={now}
          onJumpToMessage={onJumpToMessage}
        />
      ))}
    </aside>
  );
}
