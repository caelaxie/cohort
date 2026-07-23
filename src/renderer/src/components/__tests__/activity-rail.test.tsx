/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ActivitySnapshot,
  AgentActivityDto,
  MemberDto,
  RoomClient,
  RoomPushEvent,
  RoomSnapshot,
  ToolCallDto,
  TurnActivityDto,
} from "../../../../shared/room-types";
import { ActivityRail } from "../ActivityRail";

function card(partial: Partial<ToolCallDto> & Pick<ToolCallDto, "id" | "name">): ToolCallDto {
  return {
    status: "running",
    startedAt: 1_000,
    children: [],
    ...partial,
  };
}

function turn(partial: Partial<TurnActivityDto> & Pick<TurnActivityDto, "turnId">): TurnActivityDto {
  return {
    originSeqs: [],
    startedAt: 1_000,
    toolCalls: [],
    produced: [],
    ...partial,
  };
}

function activity(
  partial: Partial<AgentActivityDto> & Pick<AgentActivityDto, "agentId" | "agentName">,
): AgentActivityDto {
  return {
    lastActiveAt: null,
    current: null,
    recent: [],
    ...partial,
  };
}

class FakeClient implements RoomClient {
  listeners = new Set<(e: RoomPushEvent) => void>();

  constructor(private activitySnapshot: ActivitySnapshot) {}

  async getSnapshot(): Promise<RoomSnapshot> {
    return { messages: [], members: [] };
  }

  async getActivitySnapshot(): Promise<ActivitySnapshot> {
    return this.activitySnapshot;
  }

  async postMessage(): Promise<{ seq: number; chainId: string }> {
    return { seq: 1, chainId: "user-1" };
  }

  async cancelTurn(): Promise<boolean> {
    return true;
  }

  async retryAgent(): Promise<void> {}

  subscribe(listener: (event: RoomPushEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RoomPushEvent): void {
    for (const l of this.listeners) l(event);
  }

  emitMembers(members: MemberDto[]): void {
    this.emit({ type: "members", members });
  }
}

afterEach(() => {
  cleanup();
});

describe("ActivityRail", () => {
  it("shows the current tool call with duration mid-task", async () => {
    const client = new FakeClient({
      highWaterSeq: 2,
      activities: [
        activity({
          agentId: "scout",
          agentName: "Scout",
          lastActiveAt: 1_100,
          current: turn({
            turnId: "turn-1",
            originSeqs: [3],
            toolCalls: [card({ id: "c1", name: "search_web", input: { q: "parser perf" } })],
          }),
        }),
      ],
    });

    render(<ActivityRail client={client} />);

    await waitFor(() => expect(screen.getByTestId("rail-agent-scout")).toBeTruthy());
    expect(screen.getByTestId("tool-card-c1").textContent).toContain("search_web");
    expect(screen.getByTestId("tool-status-c1").textContent).toMatch(/running/i);
    // Live duration derives from startedAt.
    expect(screen.getByTestId("tool-duration-c1")).toBeTruthy();
    // Card links back to the chat message that spawned the work.
    expect(screen.getByTestId("rail-origin-3").textContent).toContain("#3");
  });

  it("lists produced workspace items under the agent's turn", async () => {
    const client = new FakeClient({
      highWaterSeq: 4,
      activities: [
        activity({
          agentId: "muse",
          agentName: "Muse",
          lastActiveAt: 1_200,
          current: turn({
            turnId: "turn-1",
            toolCalls: [
              card({
                id: "w1",
                name: "write_file",
                status: "done",
                durationMs: 120,
                input: { file_path: "notes.md" },
              }),
            ],
            produced: [{ path: "notes.md", toolCallId: "w1" }],
          }),
        }),
      ],
    });

    render(<ActivityRail client={client} />);

    await waitFor(() => expect(screen.getByTestId("produced-muse")).toBeTruthy());
    expect(screen.getByTestId("produced-muse").textContent).toContain("notes.md");
  });

  it("nests subagent steps under the parent card, collapsed by default", async () => {
    const client = new FakeClient({
      highWaterSeq: 5,
      activities: [
        activity({
          agentId: "scout",
          agentName: "Scout",
          current: turn({
            turnId: "turn-1",
            toolCalls: [
              card({
                id: "parent",
                name: "task",
                children: [card({ id: "child", name: "search_web", status: "done", durationMs: 50 })],
              }),
            ],
          }),
        }),
      ],
    });

    render(<ActivityRail client={client} />);

    await waitFor(() => expect(screen.getByTestId("tool-card-parent")).toBeTruthy());
    const children = screen.getByTestId("tool-children-parent");
    expect(children.hasAttribute("open")).toBe(false);
    // Expand to reveal the nested subagent step.
    fireEvent.click(screen.getByTestId("tool-children-toggle-parent"));
    expect(screen.getByTestId("tool-children-parent").hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("tool-card-child").textContent).toContain("search_web");
  });

  it("catches up from the event log after a reload without duplicates", async () => {
    const client = new FakeClient({
      highWaterSeq: 10,
      activities: [
        activity({
          agentId: "scout",
          agentName: "Scout",
          current: turn({
            turnId: "turn-1",
            toolCalls: [card({ id: "c1", name: "search_web" })],
          }),
        }),
      ],
    });

    render(<ActivityRail client={client} />);
    await waitFor(() => expect(screen.getByTestId("tool-card-c1")).toBeTruthy());

    // A stale push at or below the hydration high-water mark is dropped.
    act(() => {
      client.emit({
        type: "activity",
        agentId: "scout",
        eventSeq: 10,
        activity: activity({
          agentId: "scout",
          agentName: "Scout",
          current: turn({
            turnId: "turn-1",
            toolCalls: [card({ id: "c1", name: "search_web", status: "done", durationMs: 10 })],
          }),
        }),
      });
    });
    expect(screen.getByTestId("tool-status-c1").textContent).toMatch(/running/i);

    // A fresh push folds once.
    act(() => {
      client.emit({
        type: "activity",
        agentId: "scout",
        eventSeq: 11,
        activity: activity({
          agentId: "scout",
          agentName: "Scout",
          current: turn({
            turnId: "turn-1",
            toolCalls: [card({ id: "c1", name: "search_web", status: "done", durationMs: 10 })],
          }),
        }),
      });
    });
    expect(screen.getByTestId("tool-status-c1").textContent).toMatch(/done/i);
    expect(screen.getAllByTestId("tool-card-c1")).toHaveLength(1);
  });

  it("marks a live tool call interrupted when the turn is cancelled", async () => {
    const client = new FakeClient({
      highWaterSeq: 1,
      activities: [
        activity({
          agentId: "scout",
          agentName: "Scout",
          current: turn({
            turnId: "turn-1",
            toolCalls: [card({ id: "c1", name: "search_web" })],
          }),
        }),
      ],
    });

    render(<ActivityRail client={client} />);
    await waitFor(() => expect(screen.getByTestId("tool-card-c1")).toBeTruthy());

    act(() => {
      client.emit({
        type: "activity",
        agentId: "scout",
        eventSeq: 2,
        activity: activity({
          agentId: "scout",
          agentName: "Scout",
          current: null,
          recent: [
            turn({
              turnId: "turn-1",
              outcome: "cancelled",
              toolCalls: [card({ id: "c1", name: "search_web", status: "interrupted", durationMs: 900 })],
            }),
          ],
        }),
      });
    });

    expect(screen.getByTestId("tool-status-c1").textContent).toMatch(/interrupted/i);
  });

  it("shows an idle placeholder with last-active age, and appears for new members", async () => {
    const now = Date.now();
    const client = new FakeClient({
      highWaterSeq: 0,
      activities: [
        activity({ agentId: "muse", agentName: "Muse", lastActiveAt: now - 5 * 60_000 }),
      ],
    });

    render(<ActivityRail client={client} />);
    await waitFor(() => expect(screen.getByTestId("rail-idle-muse")).toBeTruthy());
    expect(screen.getByTestId("rail-idle-muse").textContent).toMatch(/idle/i);
    expect(screen.getByTestId("rail-idle-muse").textContent).toMatch(/5m/);

    // A member added later (no folded events yet) gets an idle entry.
    act(() => {
      client.emitMembers([
        {
          id: "coder",
          name: "Coder",
          persona: "writes code",
          presence: "idle",
          statusLine: null,
          lastFailure: null,
        },
      ]);
    });
    expect(screen.getByTestId("rail-idle-coder").textContent).toMatch(/idle/i);
  });

  it("collapses earlier turns within the retained bound", async () => {
    const client = new FakeClient({
      highWaterSeq: 9,
      activities: [
        activity({
          agentId: "scout",
          agentName: "Scout",
          current: turn({ turnId: "turn-3", toolCalls: [card({ id: "c3", name: "grep" })] }),
          recent: [
            turn({ turnId: "turn-2", outcome: "done", toolCalls: [card({ id: "c2", name: "glob", status: "done" })] }),
            turn({ turnId: "turn-1", outcome: "done", toolCalls: [card({ id: "c1", name: "ls", status: "done" })] }),
          ],
        }),
      ],
    });

    render(<ActivityRail client={client} />);
    await waitFor(() => expect(screen.getByTestId("tool-card-c3")).toBeTruthy());

    const recent = screen.getByTestId("rail-recent-scout");
    expect(recent.hasAttribute("open")).toBe(false);
    expect(recent.textContent).toMatch(/2 earlier turn/);
    fireEvent.click(screen.getByTestId("rail-recent-toggle-scout"));
    expect(screen.getByTestId("tool-card-c2")).toBeTruthy();
    expect(screen.getByTestId("tool-card-c1")).toBeTruthy();
  });
});
