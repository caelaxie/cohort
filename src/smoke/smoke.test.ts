/**
 * End-to-end smoke: the v1 demo path through the real main-process stack —
 * first-run → preset agent → @mention → rail activity → quit mid-task →
 * relaunch → history + agents back online → memory checkpoint reused.
 *
 * Runs on-disk (temp userData) with the deterministic stub model; the deep
 * memory-resume semantics are covered by the memory integration tests.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { AGENT_PRESETS } from "../shared/agent-config";
import { createRoomAgent } from "../main/agents/agent-factory";
import { StubChatModel, type StubReply } from "../main/agents/stub-model";
import { createRoomWorkspace } from "../main/agents/workspace";
import { RoomHost } from "../main/room-host";

const researcher = AGENT_PRESETS.find((p) => p.label === "Researcher")!;

describe("smoke: first-run → preset agent → mention → rail → relaunch", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-room-smoke-"));
  const roomDbPath = join(dir, "room.db");
  const workspaceDir = join(dir, "workspace");
  const checkpointsDir = join(dir, "checkpoints");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeHost(scripts: StubReply[][]): RoomHost {
    const workspace = createRoomWorkspace(workspaceDir);
    const queue = [...scripts];
    return new RoomHost({
      roomDbPath,
      workspaceDir,
      checkpointsDir,
      sessionOptions: {
        // Mirrors the production factory (jailed backend + per-agent
        // checkpoint dir) with the deterministic stub model swapped in.
        factory: (config) =>
          createRoomAgent({
            ...config,
            model: new StubChatModel({ script: queue.shift() ?? [{ tokens: ["ok"] }] }),
            backend: workspace.createBackend(),
            memoryDir: checkpointsDir,
          }),
      },
    });
  }

  it("walks the whole demo path", async () => {
    // ---- Run 1: first launch ---------------------------------------------
    const hostA = makeHost([
      [
        {
          tokens: ["Saving my findings. "],
          toolCalls: [
            { name: "write_file", args: { file_path: "findings.md", content: "parser notes" }, id: "w1" },
          ],
        },
        { tokens: ["Done — findings are in findings.md."] },
        { tokens: ["still ", "working ", "on it"], tokenDelayMs: 200 },
      ],
    ]);
    hosts.push(hostA);

    // First run: empty room.
    expect(hostA.getSnapshot().messages).toHaveLength(0);
    expect(hostA.getSnapshot().members).toHaveLength(0);
    await hostA.restoreAgents(); // no-op before any agent exists

    // Create from preset → member comes online.
    const created = await hostA.createAgent(researcher.config);
    expect(created.ok).toBe(true);
    expect(hostA.sessions.getPresence("scout")).toBe("idle");

    // @mention → reply lands; the rail shows the turn's tool call + output.
    await hostA.postMessage("@Scout pull together the parser findings");
    await hostA.broker.idle();

    const activityA = hostA
      .getActivitySnapshot()
      .activities.find((a) => a.agentId === "scout");
    expect(activityA?.recent).toHaveLength(1);
    expect(activityA?.recent[0].toolCalls.map((c) => c.name)).toContain("write_file");
    expect(activityA?.recent[0].produced).toEqual([
      { path: "findings.md", toolCallId: "w1" },
    ]);

    // Quit mid-task: in-flight turn is cancelled and marked.
    await hostA.postMessage("@Scout keep going with a slow task");
    await vi.waitFor(() => {
      expect(hostA.sessions.getPresence("scout")).toBe("thinking");
    });
    const markers = await hostA.sessions.shutdown();
    expect(markers.some((m) => m.agentId === "scout")).toBe(true);
    for (const marker of markers) {
      hostA.broker.recordInterruption(marker);
    }
    await hostA.broker.idle();
    hostA.dispose();
    hostA.store.close();

    // Memory persisted to the agent's checkpoint file during run 1.
    const checkpointPath = join(checkpointsDir, "scout.checkpoint.sqlite");
    expect(existsSync(checkpointPath)).toBe(true);
    expect(statSync(checkpointPath).size).toBeGreaterThan(0);

    // ---- Run 2: relaunch over the same directory -------------------------
    const hostB = makeHost([[{ tokens: ["back online"] }]]);
    hosts.push(hostB);
    await hostB.restoreAgents();

    // Full history is visible, including the reply and the quit marker.
    const snap = hostB.getSnapshot();
    expect(
      snap.messages.some(
        (m) => m.authorType === "agent" && m.text.includes("findings.md"),
      ),
    ).toBe(true);
    expect(
      snap.messages.some((m) => m.authorType === "system" && /Interrupted/.test(m.text)),
    ).toBe(true);

    // The agent comes back online against the same checkpoint.
    await vi.waitFor(() => {
      expect(hostB.sessions.getPresence("scout")).toBe("idle");
    });
    expect(hostB.sessions.listAgents().map((a) => a.id)).toContain("scout");

    // The rail caught up from the persisted event log (no duplicates).
    const activityB = hostB
      .getActivitySnapshot()
      .activities.find((a) => a.agentId === "scout");
    expect(activityB?.recent.length).toBeGreaterThan(0);
    const writeCards = activityB!.recent.flatMap((t) =>
      t.toolCalls.filter((c) => c.name === "write_file"),
    );
    expect(writeCards).toHaveLength(1);

    // And the room keeps working: the relaunched agent answers again.
    await hostB.postMessage("@Scout are you back?");
    await hostB.broker.idle();
    expect(
      hostB.store
        .listMessages()
        .some((m) => m.authorType === "agent" && m.text.includes("back online")),
    ).toBe(true);
  }, 30_000);

  const hosts: RoomHost[] = [];
  afterAll(async () => {
    for (const host of hosts.splice(0)) {
      await host.sessions.shutdown().catch(() => {});
      host.dispose();
      host.store.close();
    }
  });
});
