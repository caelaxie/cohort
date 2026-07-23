/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MemberDto,
  RoomClient,
  RoomMessageDto,
  RoomPushEvent,
  RoomSnapshot,
} from "../../../../shared/room-types";
import { Room } from "../Room";
import { Composer } from "../Composer";
import { MessageList } from "../MessageList";
import { renderMarkdown } from "../../lib/markdown";

function msg(partial: Partial<RoomMessageDto> & Pick<RoomMessageDto, "seq" | "text">): RoomMessageDto {
  return {
    id: partial.seq,
    authorType: partial.authorType ?? "user",
    authorId: partial.authorId ?? "user",
    authorName: partial.authorName ?? "User",
    createdAt: partial.createdAt ?? Date.now(),
    interrupted: partial.interrupted,
    ...partial,
  };
}

function member(partial: Partial<MemberDto> & Pick<MemberDto, "id" | "name">): MemberDto {
  return {
    persona: partial.persona ?? "helper",
    presence: partial.presence ?? "idle",
    statusLine: partial.statusLine ?? null,
    lastFailure: partial.lastFailure ?? null,
    ...partial,
  };
}

class FakeClient implements RoomClient {
  snapshot: RoomSnapshot;
  listeners = new Set<(e: RoomPushEvent) => void>();
  posted: string[] = [];
  cancelled: string[] = [];
  retried: string[] = [];
  failNextPost = false;

  constructor(snapshot: RoomSnapshot) {
    this.snapshot = snapshot;
  }

  async getSnapshot(): Promise<RoomSnapshot> {
    return this.snapshot;
  }

  async postMessage(text: string): Promise<{ seq: number; chainId: string }> {
    if (this.failNextPost) {
      this.failNextPost = false;
      throw new Error("network down");
    }
    this.posted.push(text);
    const message = msg({
      seq: this.snapshot.messages.length + 1,
      text,
      authorType: "user",
      authorId: "user",
      authorName: "User",
    });
    this.snapshot = {
      ...this.snapshot,
      messages: [...this.snapshot.messages, message],
    };
    this.emit({ type: "message", message });
    return { seq: message.seq, chainId: `user-${message.seq}` };
  }

  async cancelTurn(agentId: string): Promise<boolean> {
    this.cancelled.push(agentId);
    return true;
  }

  async retryAgent(agentId: string): Promise<void> {
    this.retried.push(agentId);
  }

  subscribe(listener: (event: RoomPushEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RoomPushEvent): void {
    for (const l of this.listeners) l(event);
  }
}

afterEach(() => {
  cleanup();
});

describe("Room UI (U6)", () => {
  it("renders room history in stored order on load (R4)", async () => {
    const client = new FakeClient({
      messages: [
        msg({ seq: 1, text: "first", authorName: "User" }),
        msg({
          seq: 2,
          text: "second",
          authorType: "agent",
          authorId: "scout",
          authorName: "Scout",
        }),
        msg({ seq: 3, text: "system note", authorType: "system", authorId: "system", authorName: "Room" }),
      ],
      members: [member({ id: "scout", name: "Scout", presence: "idle" })],
    });

    render(<Room client={client} onOpenBuilder={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("msg-1")).toBeTruthy();
    });
    const list = screen.getByTestId("message-list");
    const nodes = within(list).getAllByTestId(/msg-/);
    expect(nodes.map((n) => n.getAttribute("data-testid"))).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
    ]);
    expect(screen.getByTestId("msg-3").getAttribute("data-author")).toBe("system");
  });

  it("shows empty state and disables composer when no agents (F1)", async () => {
    const open = vi.fn();
    const client = new FakeClient({ messages: [], members: [] });
    render(<Room client={client} onOpenBuilder={open} />);

    await waitFor(() => {
      expect(screen.getByTestId("room-empty")).toBeTruthy();
    });
    expect(screen.getByTestId("composer-input")).toBeDisabled();
    expect(screen.getByTestId("composer-send")).toBeDisabled();

    fireEvent.click(screen.getByTestId("empty-create"));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("enables composer once an agent exists", async () => {
    const client = new FakeClient({
      messages: [],
      members: [member({ id: "scout", name: "Scout" })],
    });
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId("composer-input")).not.toBeDisabled();
    });
  });

  it("reflects presence transitions in the member list", async () => {
    const client = new FakeClient({
      messages: [],
      members: [member({ id: "scout", name: "Scout", presence: "idle", statusLine: null })],
    });
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("member-scout")).toBeTruthy());

    act(() => {
      client.emit({
        type: "presence",
        member: member({
          id: "scout",
          name: "Scout",
          presence: "runningTool",
          statusLine: "running search_web…",
        }),
      });
    });

    const row = screen.getByTestId("member-scout");
    expect(row.getAttribute("data-presence")).toBe("runningTool");
    expect(screen.getByTestId("status-scout").textContent).toContain("search_web");
    expect(screen.getByTestId("stop-scout")).toBeTruthy();
  });

  it("coalesces streaming tokens into one bubble (not per-token DOM thrash)", async () => {
    const client = new FakeClient({
      messages: [],
      members: [member({ id: "scout", name: "Scout", presence: "thinking" })],
    });
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("member-scout")).toBeTruthy());

    act(() => {
      client.emit({ type: "token", agentId: "scout", agentName: "Scout", text: "Hel" });
      client.emit({ type: "token", agentId: "scout", agentName: "Scout", text: "lo" });
      client.emit({ type: "token", agentId: "scout", agentName: "Scout", text: "!" });
    });

    await waitFor(() => {
      expect(screen.getByText("Hello!")).toBeTruthy();
    });
    // Single streaming bubble for the agent.
    expect(document.querySelectorAll('[data-streaming="true"]').length).toBe(1);
  });

  it("mention autocomplete inserts @Name and Enter sends", async () => {
    const user = userEvent.setup();
    const client = new FakeClient({
      messages: [],
      members: [
        member({ id: "scout", name: "Scout" }),
        member({ id: "muse", name: "Muse" }),
      ],
    });
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("composer-input")).not.toBeDisabled());

    const input = screen.getByTestId("composer-input");
    await user.click(input);
    await user.type(input, "hey @Sc");
    expect(screen.getByTestId("mention-menu")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect((input as HTMLTextAreaElement).value).toContain("@Scout");

    await user.type(input, " look at this");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(client.posted.length).toBe(1);
    });
    expect(client.posted[0]).toMatch(/@Scout/);
  });

  it("retains the draft when send fails", async () => {
    const user = userEvent.setup();
    const client = new FakeClient({
      messages: [],
      members: [member({ id: "scout", name: "Scout" })],
    });
    client.failNextPost = true;
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("composer-input")).not.toBeDisabled());

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    await user.type(input, "keep me");
    await user.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(screen.getByTestId("composer-error")).toBeTruthy();
    });
    expect(input.value).toBe("keep me");
  });

  it("surfaces agent failure with retry and wires stop on busy members (F5)", async () => {
    const client = new FakeClient({
      messages: [
        msg({
          seq: 1,
          text: "Scout can't reach the model — check the API key.",
          authorType: "system",
          authorId: "system",
          authorName: "Room",
        }),
      ],
      members: [
        member({
          id: "scout",
          name: "Scout",
          presence: "offline",
          statusLine: "offline",
          lastFailure: {
            kind: "auth",
            message: "invalid api key",
            at: Date.now(),
            retryable: true,
          },
        }),
      ],
    });
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("retry-scout")).toBeTruthy());

    fireEvent.click(screen.getByTestId("retry-scout"));
    await waitFor(() => expect(client.retried).toEqual(["scout"]));

    act(() => {
      client.emit({
        type: "presence",
        member: member({
          id: "scout",
          name: "Scout",
          presence: "thinking",
          statusLine: "thinking…",
          lastFailure: null,
        }),
      });
    });
    fireEvent.click(screen.getByTestId("stop-scout"));
    await waitFor(() => expect(client.cancelled).toEqual(["scout"]));
  });

  it("keeps an interrupted marker on cancelled partials", async () => {
    const client = new FakeClient({
      messages: [
        msg({
          seq: 1,
          text: "partial answer",
          authorType: "agent",
          authorId: "scout",
          authorName: "Scout",
          interrupted: true,
        }),
      ],
      members: [member({ id: "scout", name: "Scout", presence: "idle" })],
    });
    render(<Room client={client} onOpenBuilder={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId("interrupted-1")).toBeTruthy();
    });
    expect(screen.getByTestId("msg-1").getAttribute("data-interrupted")).toBe("true");
  });

  it("Shift+Enter inserts a newline without sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => true);
    render(
      <Composer
        members={[member({ id: "scout", name: "Scout" })]}
        disabled={false}
        sending={false}
        sendError={null}
        onSend={onSend}
      />,
    );
    const input = screen.getByTestId("composer-input");
    await user.type(input, "line1");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(input, "line2");
    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toContain("\n");
  });
});

describe("markdown renderer", () => {
  it("renders links only for http(s) and leaves raw HTML inert", () => {
    const { container } = render(
      <div>{renderMarkdown('see [ok](https://example.com) and [bad](javascript:alert(1)) and <img src=x onerror=alert(1)>')}</div>,
    );
    const anchors = container.querySelectorAll("a");
    expect(anchors.length).toBe(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com");
    // Raw HTML is text, not a node.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("tolerates an unterminated fence while streaming", () => {
    const { container } = render(
      <div>{renderMarkdown("before\n```js\nconst x = 1")}</div>,
    );
    expect(container.querySelector("pre")).toBeTruthy();
    expect(container.textContent).toContain("const x = 1");
  });
});

describe("MessageList virtualization threshold", () => {
  it("uses the virtual scroller once history is long", () => {
    const messages = Array.from({ length: 45 }, (_, i) =>
      msg({ seq: i + 1, text: `m${i + 1}` }),
    );
    render(
      <MessageList
        messages={messages}
        streams={{}}
        members={[]}
        onStop={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("message-list-virtual")).toBeTruthy();
  });
});
