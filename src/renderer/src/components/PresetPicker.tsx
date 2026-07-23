import type { AgentPreset } from "../../../shared/agent-config";

export interface PresetPickerProps {
  presets: readonly AgentPreset[];
  onPick: (preset: AgentPreset) => void;
}

export function PresetPicker(props: PresetPickerProps): React.JSX.Element {
  return (
    <div className="preset-picker" data-testid="preset-picker">
      {props.presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="preset-card"
          data-testid={`preset-${preset.id}`}
          onClick={() => props.onPick(preset)}
        >
          <span className="preset-emoji" aria-hidden>
            {preset.config.avatar.emoji}
          </span>
          <span className="preset-label">{preset.label}</span>
          <span className="preset-blurb">{preset.blurb}</span>
        </button>
      ))}
    </div>
  );
}
