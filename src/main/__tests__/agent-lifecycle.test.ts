import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_PRESETS, type AgentConfigInput } from "../../shared/agent-config";
import { createRoomAgent, type RoomAgentConfig } from "../agents/agent-factory";
import { StubChatModel, type StubReply } from "../agents/stub-model";
import { RoomHost } from "../room-host";

const researcher = AGENT_PRESETS.find((p) => p.label === "Researcher")!;

describe("RoomHost agent lifecycle", () => {
  const hosts: RoomHost[] = [];

  afterEach(async () => {
    for (const host of hosts.splice(0)) {
      await host.sessions.shutdown();
      host.dispose();
      host.store.close();
    }
  });

  function makeHost(scripts: StubReply[][]) {
    const captured: RoomAgentConfig[] = [];
    const host = new RoomHost({
      roomDbPath: ":memory:",
      sessionOptions: {
        factory: (config) => {
          captured.push({ ...config });
          return createRoomAgent({
            model: new StubChatModel({
              script: scripts[captured.length - 1] ?? [{ tokens: ["ok"] }],
            }),
            name: config.name,
            systemPrompt: config.systemPrompt,
          });
        },
      },
    });
    hosts.push(host);
    return { host, captured };
  }

  it("creates an agent from a preset; it joins the room and answers a mention", async () => {
    const { host } = makeHost([[{ tokens: ["On it — checking the sources."] }]]);

    const result = await host.createAgent(researcher.config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member.id).toBe("scout");
    expect(result.member.presence).not.toBe("offline");
    expect(result.member.avatar).toEqual(researcher.config.avatar);

    // The stored record carries the full config for later edits/restarts.
    const stored = host.store.getAgent("scout");
    expect(stored?.config.model).toBe(researcher.config.model);
    expect(stored?.config.tools).toEqual(researcher.config.tools);

    await host.postMessage("@Scout what is the room up to?");
    await host.broker.idle();

    const replies = host.store
      .listMessages()
      .filter((m) => m.authorType === "agent" && m.authorId === "scout");
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain("On it — checking the sources.");
    // Reply attribution captured the preset avatar at write time.
    expect(replies[0].avatar).toEqual(researcher.config.avatar);
  });

  it("rejects invalid input without touching the roster", async () => {
    const { host } = makeHost([]);

    const result = await host.createAgent({
      ...researcher.config,
      model: "gpt-9000-ultra",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.model).toBeTruthy();
    expect(host.store.countAgents()).toBe(0);
  });

  it("edit mid-turn: running turn finishes old config, next turn uses new one", async () => {
    const { host, captured } = makeHost([
      [
        { tokens: ["slow ", "old ", "turn"], tokenDelayMs: 30 },
        { tokens: ["stale"] },
      ],
      [{ tokens: ["new config reply"] }],
    ]);

    await host.createAgent(researcher.config);
    expect(captured[0].systemPrompt).toBe(researcher.config.persona);

    const posted = host.postMessage("@Scout first question");
    await vi.waitFor(() => {
      expect(host.sessions.getPresence("scout")).toBe("thinking");
    });

    const edited: AgentConfigInput = {
      ...researcher.config,
      persona: "You are Scout, a terse fact-checker. You speak up only when the topic is squarely yours.",
      memory: { triggerMessages: 5, keepMessages: 2 },
    };
    const update = await host.updateAgent("scout", edited);
    expect(update.ok).toBe(true);

    await posted;
    await host.broker.idle();

    // The recreate happened after the in-flight turn settled, carrying the
    // new persona and memory override into the next instance.
    await vi.waitFor(() => expect(captured.length).toBe(2));
    expect(captured[1].systemPrompt).toBe(edited.persona);
    expect(captured[1].memory).toEqual({ triggerMessages: 5, keepMessages: 2 });

    await host.postMessage("@Scout second question");
    await host.broker.idle();

    const replies = host.store
      .listMessages()
      .filter((m) => m.authorType === "agent");
    expect(replies.map((m) => m.text).join(" ")).toContain("new config reply");

    // The stored record reflects the edit.
    expect(host.store.getAgent("scout")?.persona).toBe(edited.persona);
  });

  it("remove mid-task: turn cancelled, notes written, history retained", async () => {
    const { host } = makeHost([
      [
        { tokens: ["first answer"] },
        { tokens: ["long ", "running ", "task ", "here"], tokenDelayMs: 60 },
      ],
    ]);

    await host.createAgent(researcher.config);
    await host.postMessage("@Scout first");
    await host.broker.idle();

    const second = host.postMessage("@Scout do something slow");
    await vi.waitFor(() => {
      expect(host.sessions.getPresence("scout")).toBe("thinking");
    });

    await host.removeAgent("scout");
    await second;
    await host.broker.idle();

    // Roster and live sessions drop the agent…
    expect(host.store.getAgent("scout")).toBeNull();
    expect(host.listMembers().some((m) => m.id === "scout")).toBe(false);
    expect(host.sessions.listAgents()).toHaveLength(0);

    const messages = host.store.listMessages();
    // …its earlier reply stays attributed in history…
    expect(
      messages.some((m) => m.authorType === "agent" && m.authorName === "Scout"),
    ).toBe(true);
    // …the interruption is marked, and the removal is noted in the room.
    const systemTexts = messages
      .filter((m) => m.authorType === "system")
      .map((m) => m.text)
      .join("\n");
    expect(systemTexts).toMatch(/Interrupted/);
    expect(systemTexts).toMatch(/removed from the room/);
  });

  it("passes the preset persona to the relevance gate as the judging rubric", async () => {
    const gateInputs: string[] = [];
    const host = new RoomHost({
      roomDbPath: ":memory:",
      gate: (input) => {
        gateInputs.push(input.agent.persona);
        return false; // restrained: nobody chimes in
      },
      sessionOptions: {
        factory: (config) =>
          createRoomAgent({
            model: new StubChatModel({ script: [{ tokens: ["ok"] }] }),
            name: config.name,
          }),
      },
    });
    hosts.push(host);

    await host.createAgent(researcher.config);
    await host.postMessage("unrelated chatter about weekend plans");
    await host.broker.idle();

    // The gate judged the message against the preset persona…
    expect(gateInputs).toHaveLength(1);
    expect(gateInputs[0]).toContain("speak up only when the topic is squarely yours");
    // …and stayed silent: no agent reply landed.
    expect(host.store.listMessages().every((m) => m.authorType !== "agent")).toBe(true);
  });
});
