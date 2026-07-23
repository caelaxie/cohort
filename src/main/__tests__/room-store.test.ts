import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RoomStore } from "../room-store";

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "room-store-"));
  dbFile = join(dir, "room.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RoomStore", () => {
  it("assigns monotonic sequence numbers in append order", () => {
    const store = new RoomStore(":memory:");
    const a = store.appendMessage({
      authorType: "user",
      authorId: "user",
      authorName: "User",
      text: "one",
    });
    const b = store.appendMessage({
      authorType: "agent",
      authorId: "scout",
      authorName: "Scout",
      text: "two",
    });
    const note = store.appendMessage({
      authorType: "system",
      authorId: "system",
      authorName: "Room",
      text: "Interrupted: Scout's turn was cancelled.",
    });
    expect(a.seq).toBeLessThan(b.seq);
    expect(b.seq).toBeLessThan(note.seq);
    expect(store.listMessages().map((m) => m.text)).toEqual(["one", "two", note.text]);
    expect(store.listMessages({ afterSeq: a.seq }).map((m) => m.text)).toEqual([
      "two",
      note.text,
    ]);
    store.close();
  });

  it("tracks per-agent delivery watermarks", () => {
    const store = new RoomStore(":memory:");
    store.appendMessage({
      authorType: "user",
      authorId: "user",
      authorName: "User",
      text: "hello",
    });
    expect(store.getLastDeliveredSeq("muse")).toBe(0);
    expect(store.getMissedMessages("muse")).toHaveLength(1);
    store.setLastDeliveredSeq("muse", 1);
    expect(store.getMissedMessages("muse")).toHaveLength(0);
    store.close();
  });

  it("round-trips messages, events, and interruption markers across reopen", () => {
    const first = new RoomStore(dbFile);
    first.addAgent({
      id: "scout",
      name: "Scout",
      persona: "Researches and verifies claims.",
      config: { model: "stub", tools: ["read_file"] },
    });
    const m1 = first.appendMessage({
      authorType: "user",
      authorId: "user",
      authorName: "User",
      text: "@Scout why is the parser slow?",
    });
    const m2 = first.appendMessage({
      authorType: "agent",
      authorId: "scout",
      authorName: "Scout",
      text: "Parsers are IO-bound.",
    });
    const marker = first.appendMessage({
      authorType: "system",
      authorId: "system",
      authorName: "Room",
      text: "Interrupted: Scout was thinking when the app shut down (2 message(s) still queued).",
    });
    first.appendEvent({
      agentId: "scout",
      kind: "token",
      payload: { kind: "token", text: "Parsers" },
      turnId: "turn-1",
    });
    first.appendEvent({
      agentId: "scout",
      kind: "turn.end",
      payload: { kind: "turn.end", reason: "done" },
      turnId: "turn-1",
    });
    first.setLastDeliveredSeq("scout", m2.seq);
    first.close();

    const store = new RoomStore(dbFile);
    try {
      // Messages come back in stable sequence order with attribution intact.
      const messages = store.listMessages();
      expect(messages.map((m) => m.seq)).toEqual([m1.seq, m2.seq, marker.seq]);
      expect(messages.map((m) => m.authorType)).toEqual(["user", "agent", "system"]);
      expect(messages.map((m) => m.authorName)).toEqual(["User", "Scout", "Room"]);
      expect(messages.map((m) => m.text)).toEqual([
        "@Scout why is the parser slow?",
        "Parsers are IO-bound.",
        "Interrupted: Scout was thinking when the app shut down (2 message(s) still queued).",
      ]);

      // Events round-trip with payloads and turn ids.
      const events = store.listEvents({ agentId: "scout" });
      expect(events.map((e) => e.kind)).toEqual(["token", "turn.end"]);
      expect(events[0].payload).toEqual({ kind: "token", text: "Parsers" });
      expect(events[1].payload).toEqual({ kind: "turn.end", reason: "done" });
      expect(events.every((e) => e.turnId === "turn-1")).toBe(true);
      expect(events[0].seq).toBeLessThan(events[1].seq);

      // Agent roster and per-agent watermark survive the reopen.
      expect(store.getAgent("scout")).toEqual({
        id: "scout",
        name: "Scout",
        persona: "Researches and verifies claims.",
        config: { model: "stub", tools: ["read_file"] },
      });
      expect(store.getLastDeliveredSeq("scout")).toBe(m2.seq);
      // Only the post-watermark interruption marker is still missed.
      expect(store.getMissedMessages("scout").map((m) => m.seq)).toEqual([marker.seq]);
    } finally {
      store.close();
    }
  });
});
