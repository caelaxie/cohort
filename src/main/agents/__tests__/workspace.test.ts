/**
 * U5 workspace tests (KTD11, KTD15): one shared room workspace directory,
 * jailed per-agent `FilesystemBackend` instances (`virtualMode: true`), and
 * typed, recoverable denials for escape attempts — exercised both directly
 * and end to end through an agent's `write_file` tool call.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createRoomAgent } from "../agent-factory";
import { StubChatModel } from "../stub-model";
import { runTurn, type RoomEvent } from "../turn-runner";
import { createRoomWorkspace } from "../workspace";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-room-ws-"));
}

async function collect(events: AsyncIterable<RoomEvent>): Promise<RoomEvent[]> {
  const out: RoomEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("shared room workspace (KTD11)", () => {
  it("creates the root directory and shares it across per-agent backends", async () => {
    const root = join(makeTmpDir(), "workspace");
    const workspace = createRoomWorkspace(root);
    expect(workspace.rootDir).toBe(resolve(root));
    expect(existsSync(workspace.rootDir)).toBe(true);

    // Two agents, two backend instances, one directory (KTD11).
    const scoutFs = workspace.createBackend();
    const museFs = workspace.createBackend();

    const write = await scoutFs.write("/notes/shared.md", "from scout");
    expect(write.error).toBeUndefined();

    const read = await museFs.read("/notes/shared.md");
    expect(read.error).toBeUndefined();
    expect(read.content).toContain("from scout");

    // The file really lives under the shared root on disk.
    expect(
      readFileSync(join(workspace.rootDir, "notes", "shared.md"), "utf8"),
    ).toBe("from scout");
  });
});

describe("workspace jail (KTD15)", () => {
  it("denies `..` traversal with a typed error and writes nothing", async () => {
    const workspace = createRoomWorkspace(join(makeTmpDir(), "workspace"));
    const backend = workspace.createBackend();

    const result = await backend.write("../escape.txt", "get me out");
    expect(result.error).toMatch(/traversal|outside/i);
    expect(existsSync(resolve(workspace.rootDir, "..", "escape.txt"))).toBe(
      false,
    );
  });

  it("denies `~` home-directory escape", async () => {
    const workspace = createRoomWorkspace(join(makeTmpDir(), "workspace"));
    const backend = workspace.createBackend();

    const result = await backend.write("~/escape.txt", "get me out");
    // "~/..." is rewritten to a path inside the jail or denied — either way
    // nothing lands in the real home directory.
    if (!result.error) {
      expect(existsSync(join(workspace.rootDir, "~", "escape.txt"))).toBe(true);
    }
    expect(result.path ?? "").not.toContain(resolve(String(process.env.HOME)));
  });

  it("reinterprets absolute paths inside the root instead of escaping", async () => {
    const workspace = createRoomWorkspace(join(makeTmpDir(), "workspace"));
    const backend = workspace.createBackend();

    const result = await backend.write("/abs/path.txt", "virtual absolute");
    expect(result.error).toBeUndefined();
    expect(
      readFileSync(join(workspace.rootDir, "abs", "path.txt"), "utf8"),
    ).toBe("virtual absolute");
    expect(existsSync("/abs/path.txt")).toBe(false);
  });

  it("a denial is recoverable: the backend keeps working afterwards", async () => {
    const workspace = createRoomWorkspace(join(makeTmpDir(), "workspace"));
    const backend = workspace.createBackend();

    const denied = await backend.write("../escape.txt", "nope");
    expect(denied.error).toBeDefined();

    const ok = await backend.write("/fine.txt", "still working");
    expect(ok.error).toBeUndefined();
    expect(readFileSync(join(workspace.rootDir, "fine.txt"), "utf8")).toBe(
      "still working",
    );
  });
});

describe("agent file tools through the jail (KTD15, F2)", () => {
  it("write_file outside the jail fails the tool call, not the turn", async () => {
    const workspace = createRoomWorkspace(join(makeTmpDir(), "workspace"));
    const model = new StubChatModel({
      script: [
        {
          tokens: ["Writing that file."],
          toolCalls: [
            {
              name: "write_file",
              args: { file_path: "../escape.txt", content: "get me out" },
              id: "call-escape",
            },
          ],
        },
        { tokens: ["The jail blocked it."] },
      ],
    });
    const agent = createRoomAgent({
      model,
      backend: () => workspace.createBackend(),
      permissions: [...workspace.permissions],
      name: "coder",
    });

    const events = await collect(
      runTurn(agent, [{ role: "user", content: "write ../escape.txt" }]),
    );

    const end = events.find((e) => e.kind === "tool_call.end");
    expect(end).toBeDefined();
    expect(end?.kind).toBe("tool_call.end");
    if (end?.kind === "tool_call.end") {
      // The typed denial is surfaced for the activity rail.
      expect(String(end.output ?? end.error)).toMatch(/traversal|outside/i);
    }

    // Nothing escaped the jail…
    expect(existsSync(resolve(workspace.rootDir, "..", "escape.txt"))).toBe(
      false,
    );
    // …and the turn recovered instead of crashing (R8/F5-adjacent).
    const terminal = events.at(-1);
    expect(terminal).toEqual({ kind: "turn.end", reason: "done" });
  });
});
