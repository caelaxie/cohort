import { useMemo, useState } from "react";

import type { RoomClient } from "../../shared/room-types";
import { ActivityRail } from "./components/ActivityRail";
import { Room } from "./components/Room";
import "./styles.css";
import "./types";

function ipcRoomClient(): RoomClient | null {
  if (typeof window === "undefined" || !window.agentRoom?.room) {
    return null;
  }
  return window.agentRoom.room;
}

export function App(): React.JSX.Element {
  const client = useMemo(() => ipcRoomClient(), []);
  const [builderOpen, setBuilderOpen] = useState(false);

  if (!client) {
    return (
      <main className="app-missing-api">
        <h1>Agent Room</h1>
        <p>The preload bridge is unavailable. Restart the app.</p>
      </main>
    );
  }

  return (
    <>
      <Room
        client={client}
        onOpenBuilder={() => setBuilderOpen(true)}
        onEditAgent={() => setBuilderOpen(true)}
        rail={<ActivityRail client={client} />}
      />
      {builderOpen ? (
        <div className="builder-overlay" data-testid="builder-overlay" role="dialog">
          <div className="builder-panel">
            <h2>Agent builder</h2>
            <p>
              The full builder ships in the next unit. Use it to set name, persona,
              model, and tools.
            </p>
            <button
              type="button"
              className="btn-primary"
              data-testid="builder-close"
              onClick={() => setBuilderOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
