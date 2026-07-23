import { useMemo, useState } from "react";

import {
  DEFAULT_MODEL,
  validateAgentConfig,
  type AgentConfigInput,
  type ValidationErrors,
} from "../../../shared/agent-config";
import type { AgentOptionsDto } from "../../../shared/room-types";

const EMOJI_CHOICES = ["🔍", "🛠️", "✍️", "🤖", "🧠", "📚", "🎨", "🔬"];
const COLOR_CHOICES = ["#3d8bfd", "#7fd99a", "#b48cff", "#e0b567", "#f07178", "#6ea8fe"];

const DEFAULT_INPUT: AgentConfigInput = {
  name: "",
  avatar: { emoji: "🤖", color: "#6ea8fe" },
  persona: "",
  model: DEFAULT_MODEL,
  tools: ["read_file", "ls", "glob", "grep"],
};

export interface AgentBuilderProps {
  options: AgentOptionsDto;
  /** Edit mode starts from the agent's stored config; create from a preset pick. */
  initial?: AgentConfigInput;
  busy?: boolean;
  /** Errors returned by the main process after a rejected save. */
  serverErrors?: ValidationErrors | null;
  onSubmit: (input: AgentConfigInput) => void;
  onCancel: () => void;
}

export function AgentBuilder(props: AgentBuilderProps): React.JSX.Element {
  const { options, onSubmit, onCancel } = props;
  const initial = props.initial ?? DEFAULT_INPUT;

  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState(initial.avatar.emoji);
  const [color, setColor] = useState(initial.avatar.color);
  const [persona, setPersona] = useState(initial.persona);
  const [model, setModel] = useState(initial.model);
  const [tools, setTools] = useState<Set<string>>(new Set(initial.tools));
  const [memoryCustom, setMemoryCustom] = useState(
    initial.memory !== undefined && Object.keys(initial.memory).length > 0,
  );
  const [verbatim, setVerbatim] = useState(initial.memory?.summarization === false);
  const [trigger, setTrigger] = useState(
    initial.memory?.triggerMessages !== undefined ? String(initial.memory.triggerMessages) : "",
  );
  const [keep, setKeep] = useState(
    initial.memory?.keepMessages !== undefined ? String(initial.memory.keepMessages) : "",
  );
  const [attempted, setAttempted] = useState(false);

  const input: AgentConfigInput = useMemo(() => {
    let memory: AgentConfigInput["memory"];
    if (memoryCustom) {
      memory = {};
      if (verbatim) memory.summarization = false;
      if (trigger.trim()) memory.triggerMessages = Number(trigger);
      if (keep.trim()) memory.keepMessages = Number(keep);
      if (Object.keys(memory).length === 0) memory = undefined;
    }
    return {
      name: name.trim(),
      avatar: { emoji, color },
      persona: persona.trim(),
      model,
      tools: options.tools.map((t) => t.id).filter((id) => tools.has(id)),
      memory,
    };
  }, [name, emoji, color, persona, model, tools, memoryCustom, verbatim, trigger, keep, options.tools]);

  const errors: ValidationErrors = {
    ...validateAgentConfig(input),
    ...props.serverErrors,
  };

  const showError = (field: keyof ValidationErrors): string | null =>
    (attempted || props.serverErrors) && errors[field] ? errors[field]! : null;

  const toggleTool = (id: string): void => {
    setTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const submit = (): void => {
    setAttempted(true);
    if (Object.keys(validateAgentConfig(input)).length > 0) return;
    onSubmit(input);
  };

  return (
    <div className="agent-builder" data-testid="agent-builder">
      <label className="builder-field">
        <span>Name</span>
        <input
          type="text"
          data-testid="builder-name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        {showError("name") ? (
          <span className="builder-error" data-testid="builder-error-name">
            {errors.name}
          </span>
        ) : null}
      </label>

      <div className="builder-field">
        <span>Avatar</span>
        <div className="builder-avatar-row">
          {EMOJI_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className="builder-emoji"
              data-testid={`builder-emoji-${choice}`}
              data-selected={emoji === choice || undefined}
              onClick={() => setEmoji(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
        <div className="builder-avatar-row">
          {COLOR_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className="builder-color"
              data-testid={`builder-color-${choice}`}
              data-selected={color === choice || undefined}
              style={{ background: choice }}
              aria-label={`color ${choice}`}
              onClick={() => setColor(choice)}
            />
          ))}
        </div>
        {showError("avatar") ? (
          <span className="builder-error" data-testid="builder-error-avatar">
            {errors.avatar}
          </span>
        ) : null}
      </div>

      <label className="builder-field">
        <span>Persona / instructions</span>
        <textarea
          data-testid="builder-persona"
          rows={6}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
        {showError("persona") ? (
          <span className="builder-error" data-testid="builder-error-persona">
            {errors.persona}
          </span>
        ) : null}
      </label>

      <label className="builder-field">
        <span>Model</span>
        <select
          data-testid="builder-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {options.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {showError("model") ? (
          <span className="builder-error" data-testid="builder-error-model">
            {errors.model}
          </span>
        ) : null}
      </label>

      <fieldset className="builder-field">
        <span>Tools</span>
        <div className="builder-tools">
          {options.tools.map((tool) => (
            <label key={tool.id} className="builder-tool">
              <input
                type="checkbox"
                data-testid={`tool-${tool.id}`}
                checked={tools.has(tool.id)}
                onChange={() => toggleTool(tool.id)}
              />
              <span className="builder-tool-label">{tool.label}</span>
              <span className="builder-tool-desc">{tool.description}</span>
            </label>
          ))}
        </div>
        {showError("tools") ? (
          <span className="builder-error" data-testid="builder-error-tools">
            {errors.tools}
          </span>
        ) : null}
      </fieldset>

      <div className="builder-field">
        <label className="builder-tool">
          <input
            type="checkbox"
            data-testid="memory-custom"
            checked={memoryCustom}
            onChange={(e) => setMemoryCustom(e.target.checked)}
          />
          <span className="builder-tool-label">Custom memory behavior</span>
        </label>
        {memoryCustom ? (
          <div className="builder-memory">
            <label className="builder-tool">
              <input
                type="checkbox"
                data-testid="memory-verbatim"
                checked={verbatim}
                onChange={(e) => setVerbatim(e.target.checked)}
              />
              <span className="builder-tool-label">
                Keep full verbatim context (no summarization)
              </span>
            </label>
            {!verbatim ? (
              <div className="builder-memory-grid">
                <label>
                  <span>Summarize after (messages)</span>
                  <input
                    type="number"
                    min={1}
                    data-testid="memory-trigger"
                    value={trigger}
                    placeholder="room default"
                    onChange={(e) => setTrigger(e.target.value)}
                  />
                </label>
                <label>
                  <span>Keep recent (messages)</span>
                  <input
                    type="number"
                    min={1}
                    data-testid="memory-keep"
                    value={keep}
                    placeholder="room default"
                    onChange={(e) => setKeep(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
        {showError("memory") ? (
          <span className="builder-error" data-testid="builder-error-memory">
            {errors.memory}
          </span>
        ) : null}
      </div>

      <div className="builder-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="builder-submit"
          disabled={props.busy}
          onClick={submit}
        >
          {props.busy ? "Saving…" : "Save agent"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          data-testid="builder-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
