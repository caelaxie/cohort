import { describe, expect, it } from "vitest";

import {
  AGENT_PRESETS,
  MODEL_OPTIONS,
  TOOL_CATALOG,
  validateAgentConfig,
  slugifyAgentId,
  type AgentConfigInput,
} from "../../shared/agent-config";

function validInput(overrides: Partial<AgentConfigInput> = {}): AgentConfigInput {
  return {
    name: "Scout",
    avatar: { emoji: "🔍", color: "#3d8bfd" },
    persona: "A careful researcher who cites sources.",
    model: MODEL_OPTIONS[0].id,
    tools: ["read_file", "write_file", "ls"],
    ...overrides,
  };
}

describe("validateAgentConfig", () => {
  it("accepts a valid config", () => {
    expect(validateAgentConfig(validInput())).toEqual({});
  });

  it("rejects an empty persona before save", () => {
    const errors = validateAgentConfig(validInput({ persona: "   " }));
    expect(errors.persona).toBeTruthy();
  });

  it("rejects an empty or over-long name", () => {
    expect(validateAgentConfig(validInput({ name: "" })).name).toBeTruthy();
    expect(validateAgentConfig(validInput({ name: "x".repeat(80) })).name).toBeTruthy();
  });

  it("rejects an unknown model", () => {
    const errors = validateAgentConfig(validInput({ model: "gpt-9000-ultra" }));
    expect(errors.model).toBeTruthy();
  });

  it("rejects a tool outside the catalog", () => {
    const errors = validateAgentConfig(
      validInput({ tools: ["read_file", "execute"] }),
    );
    expect(errors.tools).toBeTruthy();
    // The catalog itself never offers execute.
    expect(TOOL_CATALOG.some((t) => t.id === "execute")).toBe(false);
  });

  it("requires read_file in every tool set (SDK constraint)", () => {
    const errors = validateAgentConfig(validInput({ tools: ["write_file"] }));
    expect(errors.tools).toBeTruthy();
  });

  it("rejects a malformed avatar", () => {
    expect(
      validateAgentConfig(validInput({ avatar: { emoji: "", color: "#3d8bfd" } })).avatar,
    ).toBeTruthy();
    expect(
      validateAgentConfig(validInput({ avatar: { emoji: "🔍", color: "blue" } })).avatar,
    ).toBeTruthy();
  });

  it("rejects incoherent memory overrides", () => {
    const errors = validateAgentConfig(
      validInput({ memory: { triggerMessages: 5, keepMessages: 10 } }),
    );
    expect(errors.memory).toBeTruthy();
  });
});

describe("AGENT_PRESETS", () => {
  it("ships exactly Researcher, Coder, and Writer, all valid", () => {
    expect(AGENT_PRESETS.map((p) => p.label)).toEqual(["Researcher", "Coder", "Writer"]);
    for (const preset of AGENT_PRESETS) {
      expect(validateAgentConfig(preset.config)).toEqual({});
    }
  });

  it("bakes restrained chime-in wording into every preset persona", () => {
    for (const preset of AGENT_PRESETS) {
      expect(preset.config.persona).toMatch(/speak up only when the topic is squarely yours/i);
      expect(preset.config.persona).toMatch(/stay silent/i);
    }
  });

  it("keeps preset tool sets inside the tool-surface constraints", () => {
    const coder = AGENT_PRESETS.find((p) => p.label === "Coder")!;
    // Coder works through files only — no shell; asks the user to run builds.
    expect(coder.config.tools).not.toContain("execute");
    expect(coder.config.persona).toMatch(/no shell|ask the user/i);
    const researcher = AGENT_PRESETS.find((p) => p.label === "Researcher")!;
    expect(researcher.config.tools).toContain("fetch_url");
    const writer = AGENT_PRESETS.find((p) => p.label === "Writer")!;
    expect(writer.config.tools).toContain("write_file");
  });
});

describe("slugifyAgentId", () => {
  it("slugs names and dedupes against existing ids", () => {
    expect(slugifyAgentId("Research Scout", () => false)).toBe("research-scout");
    expect(slugifyAgentId("!!!", () => false)).toBe("agent");
    const taken = new Set(["scout", "scout-2"]);
    expect(slugifyAgentId("Scout", (id) => taken.has(id))).toBe("scout-3");
  });
});
