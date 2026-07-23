import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { MemberDto } from "../../../shared/room-types";

export interface ComposerProps {
  members: MemberDto[];
  disabled: boolean;
  sending: boolean;
  sendError: string | null;
  /** Retained draft when a prior send failed. */
  initialDraft?: string;
  onSend: (text: string) => Promise<boolean>;
}

interface MentionState {
  query: string;
  start: number;
  activeIndex: number;
}

export function Composer(props: ComposerProps): React.JSX.Element {
  const { members, disabled, sending, sendError, onSend } = props;
  const [text, setText] = useState(props.initialDraft ?? "");
  const [mention, setMention] = useState<MentionState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.initialDraft !== undefined) {
      setText(props.initialDraft);
    }
  }, [props.initialDraft]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => m.name.toLowerCase().startsWith(q) || m.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mention, members]);

  function updateMentionFromValue(value: string, caret: number): void {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) {
      setMention(null);
      return;
    }
    // Mention token runs from @ to caret; stop if whitespace intervenes.
    const token = before.slice(at + 1);
    if (/\s/.test(token)) {
      setMention(null);
      return;
    }
    // Don't trigger inside a word (e.g. email).
    if (at > 0 && /[\w]/.test(before[at - 1]!)) {
      setMention(null);
      return;
    }
    setMention({ query: token, start: at, activeIndex: 0 });
  }

  function insertMention(name: string): void {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const after = text.slice(caret);
    const next = `${before}@${name} ${after}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = before.length + name.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || disabled || sending) return;
    const ok = await onSend(trimmed);
    if (ok) {
      setText("");
      setMention(null);
    }
    // On failure, draft is retained in `text`.
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (mention && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention({
          ...mention,
          activeIndex: (mention.activeIndex + 1) % suggestions.length,
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention({
          ...mention,
          activeIndex:
            (mention.activeIndex - 1 + suggestions.length) % suggestions.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = suggestions[mention.activeIndex];
        if (pick) insertMention(pick.name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form
      className="composer"
      data-testid="composer"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
    >
      {mention && suggestions.length > 0 ? (
        <ul className="mention-menu" data-testid="mention-menu" role="listbox">
          {suggestions.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === mention.activeIndex}
                className={i === mention.activeIndex ? "mention-active" : ""}
                data-testid={`mention-${m.id}`}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  insertMention(m.name);
                }}
              >
                @{m.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        ref={textareaRef}
        className="composer-input"
        data-testid="composer-input"
        placeholder={
          disabled
            ? "Create an agent to start the conversation"
            : "Message the room — use @name to address someone"
        }
        value={text}
        disabled={disabled || sending}
        rows={3}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          updateMentionFromValue(value, e.target.selectionStart ?? value.length);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const t = e.currentTarget;
          updateMentionFromValue(t.value, t.selectionStart ?? t.value.length);
        }}
      />

      <div className="composer-footer">
        {sendError ? (
          <span className="composer-error" data-testid="composer-error">
            Couldn’t send — draft kept. {sendError}
          </span>
        ) : (
          <span className="composer-hint">Enter to send · Shift+Enter for newline</span>
        )}
        <button
          type="submit"
          className="btn-primary"
          data-testid="composer-send"
          disabled={disabled || sending || text.trim().length === 0}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
