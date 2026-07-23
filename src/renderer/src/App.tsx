import { useEffect, useMemo, useState } from "react";

import type { AgentConfigInput, ValidationErrors } from "../../shared/agent-config";
import type { AgentOptionsDto, RoomClient } from "../../shared/room-types";
import { ActivityRail } from "./components/ActivityRail";
import { AgentBuilder } from "./components/AgentBuilder";
import { PresetPicker } from "./components/PresetPicker";
import { Room } from "./components/Room";
import { SettingsPane } from "./components/SettingsPane";
import "./styles.css";
import "./types";

function ipcRoomClient(): RoomClient | null {
  if (typeof window === "undefined" || !window.agentRoom?.room) {
    return null;
  }
  return window.agentRoom.room;
}

type BuilderState =
  | { kind: "create"; initial?: AgentConfigInput }
  | { kind: "edit"; agentId: string; initial: AgentConfigInput };

export function App(): React.JSX.Element {
  const client = useMemo(() => ipcRoomClient(), []);
  const [options, setOptions] = useState<AgentOptionsDto | null>(null);
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<ValidationErrors | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.getAgentOptions().then((opts) => {
      if (!cancelled) setOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!client) {
    return (
      <main className="app-missing-api">
        <h1>Agent Room</h1>
        <p>The preload bridge is unavailable. Restart the app.</p>
      </main>
    );
  }

  const openCreate = (): void => {
    setServerErrors(null);
    setBuilder({ kind: "create" });
  };

  const openEdit = async (agentId: string): Promise<void> => {
    const config = await client.getAgentConfig(agentId);
    if (!config) return;
    setServerErrors(null);
    setBuilder({ kind: "edit", agentId, initial: config });
  };

  const submit = async (input: AgentConfigInput): Promise<void> => {
    if (!builder) return;
    setBusy(true);
    setServerErrors(null);
    try {
      const result =
        builder.kind === "edit"
          ? await client.updateAgent(builder.agentId, input)
          : await client.createAgent(input);
      if (result.ok) {
        setBuilder(null);
      } else {
        setServerErrors(result.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Room
        client={client}
        onOpenBuilder={openCreate}
        onEditAgent={(id) => void openEdit(id)}
        onRemoveAgent={(id) => void client.removeAgent(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        rail={<ActivityRail client={client} />}
      />

      {builder ? (
        <div className="builder-overlay" data-testid="builder-overlay" role="dialog">
          <div className="builder-panel">
            <h2>{builder.kind === "edit" ? "Edit agent" : "New agent"}</h2>
            {builder.kind === "create" && options ? (
              <PresetPicker
                presets={options.presets}
                onPick={(preset) => setBuilder({ kind: "create", initial: preset.config })}
              />
            ) : null}
            {options ? (
              <AgentBuilder
                key={
                  builder.kind === "edit"
                    ? `edit-${builder.agentId}`
                    : builder.initial
                      ? "preset"
                      : "blank"
                }
                options={options}
                initial={builder.initial}
                busy={busy}
                serverErrors={serverErrors}
                onSubmit={(input) => void submit(input)}
                onCancel={() => setBuilder(null)}
              />
            ) : (
              <p>Loading…</p>
            )}
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="builder-overlay" data-testid="settings-overlay" role="dialog">
          <div className="builder-panel">
            <SettingsPane
              settings={window.agentRoom.settings}
              onClose={() => setSettingsOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
