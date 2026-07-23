import { useState } from "react";

import type { ToolCallDto } from "../../../shared/room-types";

/** Compact duration: 900ms, 4.2s, 1m 5s. */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 1000) return `${Math.round(clamped)}ms`;
  if (clamped < 60_000) {
    const s = clamped / 1000;
    return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  }
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.round((clamped % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

const DETAIL_LIMIT = 240;

function pretty(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** Args/output block, truncated by default with an expand toggle. */
function Detail(props: { label: string; value: unknown; testId: string }): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const text = pretty(props.value);
  if (!text) return null;
  const long = text.length > DETAIL_LIMIT;
  const shown = expanded || !long ? text : `${text.slice(0, DETAIL_LIMIT)}…`;
  return (
    <div className="tool-detail" data-testid={props.testId}>
      <span className="tool-detail-label">{props.label}</span>
      <pre className="tool-detail-body">{shown}</pre>
      {long ? (
        <button
          type="button"
          className="tool-detail-toggle"
          data-testid={`${props.testId}-toggle`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "show less" : "show more"}
        </button>
      ) : null}
    </div>
  );
}

export interface ToolCallCardProps {
  card: ToolCallDto;
  /** Wall clock for live durations on running cards. */
  now: number;
}

export function ToolCallCard(props: ToolCallCardProps): React.JSX.Element {
  const { card, now } = props;
  const [childrenOpen, setChildrenOpen] = useState(false);
  const duration =
    card.status === "running"
      ? formatDuration(now - card.startedAt)
      : formatDuration(card.durationMs ?? 0);

  return (
    <div
      className={`tool-card tool-card-${card.status}`}
      data-testid={`tool-card-${card.id}`}
      data-status={card.status}
    >
      <div className="tool-card-head">
        <span
          className={`tool-chip tool-chip-${card.status}`}
          data-testid={`tool-status-${card.id}`}
        >
          {card.status}
        </span>
        <span className="tool-name">{card.name}</span>
        <span className="tool-duration" data-testid={`tool-duration-${card.id}`}>
          {duration}
        </span>
      </div>

      <Detail label="args" value={card.input} testId={`tool-args-${card.id}`} />
      {card.error !== undefined ? (
        <Detail label="error" value={card.error} testId={`tool-error-${card.id}`} />
      ) : (
        <Detail label="output" value={card.output} testId={`tool-output-${card.id}`} />
      )}

      {card.children.length > 0 ? (
        <details className="tool-children" data-testid={`tool-children-${card.id}`} open={childrenOpen}>
          <summary
            data-testid={`tool-children-toggle-${card.id}`}
            onClick={(e) => {
              e.preventDefault();
              setChildrenOpen((v) => !v);
            }}
          >
            {card.children.length} subagent step{card.children.length === 1 ? "" : "s"}
          </summary>
          {childrenOpen
            ? card.children.map((child) => <ToolCallCard key={child.id} card={child} now={now} />)
            : null}
        </details>
      ) : null}
    </div>
  );
}
