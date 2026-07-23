import { useEffect, useState } from "react";

export interface SettingsBridge {
  setApiKey: (provider: string, apiKey: string) => Promise<void>;
  hasApiKey: (provider: string) => Promise<boolean>;
}

export interface SettingsPaneProps {
  settings: SettingsBridge;
  onClose: () => void;
}

type KeyStatus = "loading" | "not set" | "configured" | "saved" | "error";

/** API key management; keys are stored via the safe-storage settings bridge. */
export function SettingsPane(props: SettingsPaneProps): React.JSX.Element {
  const { settings } = props;
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<KeyStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    void settings.hasApiKey("anthropic").then((has) => {
      if (!cancelled) setStatus(has ? "configured" : "not set");
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const save = async (): Promise<void> => {
    const trimmed = key.trim();
    if (!trimmed) return;
    try {
      await settings.setApiKey("anthropic", trimmed);
      setKey("");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="settings-pane" data-testid="settings-pane">
      <h3>API keys</h3>
      <label className="builder-field">
        <span>Anthropic (Claude models)</span>
        <input
          type="password"
          data-testid="api-key-input"
          value={key}
          placeholder="sk-ant-…"
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <div className="settings-row">
        <button
          type="button"
          className="btn-primary"
          data-testid="api-key-save"
          disabled={!key.trim()}
          onClick={() => void save()}
        >
          Save key
        </button>
        <span className="settings-status" data-testid="api-key-status">
          {status === "loading"
            ? "checking…"
            : status === "not set"
              ? "not set"
              : status === "configured"
                ? "configured"
                : status === "saved"
                  ? "saved"
                  : "could not save the key"}
        </span>
      </div>
      <button type="button" className="btn-ghost" data-testid="settings-close" onClick={props.onClose}>
        Close
      </button>
    </div>
  );
}
