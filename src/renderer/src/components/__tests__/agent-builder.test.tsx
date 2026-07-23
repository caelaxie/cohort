/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_PRESETS,
  MODEL_OPTIONS,
  TOOL_CATALOG,
  type AgentConfigInput,
} from "../../../../shared/agent-config";
import type { AgentOptionsDto } from "../../../../shared/room-types";
import { AgentBuilder } from "../AgentBuilder";
import { PresetPicker } from "../PresetPicker";
import { SettingsPane } from "../SettingsPane";

const OPTIONS: AgentOptionsDto = {
  models: MODEL_OPTIONS,
  tools: TOOL_CATALOG,
  presets: AGENT_PRESETS,
};

const researcher = AGENT_PRESETS.find((p) => p.label === "Researcher")!;

afterEach(() => {
  cleanup();
});

describe("PresetPicker", () => {
  it("offers the three presets and pre-fills on pick", () => {
    const onPick = vi.fn();
    render(<PresetPicker presets={AGENT_PRESETS} onPick={onPick} />);

    expect(screen.getByTestId("preset-researcher").textContent).toContain("Researcher");
    expect(screen.getByTestId("preset-coder").textContent).toContain("Coder");
    expect(screen.getByTestId("preset-writer").textContent).toContain("Writer");

    fireEvent.click(screen.getByTestId("preset-researcher"));
    expect(onPick).toHaveBeenCalledWith(researcher);
  });
});

describe("AgentBuilder", () => {
  it("renders preset values and submits the mapped config", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AgentBuilder
        options={OPTIONS}
        initial={researcher.config}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const name = screen.getByTestId("builder-name") as HTMLInputElement;
    expect(name.value).toBe("Scout");
    expect((screen.getByTestId("builder-persona") as HTMLTextAreaElement).value).toContain(
      "speak up only when the topic is squarely yours",
    );
    expect((screen.getByTestId("tool-read_file") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("tool-fetch_url") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("tool-edit_file") as HTMLInputElement).checked).toBe(false);

    // Rename and drop a tool, then save.
    await user.clear(name);
    await user.type(name, "  Hermes  ");
    await user.click(screen.getByTestId("tool-write_file"));
    await user.click(screen.getByTestId("builder-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted: AgentConfigInput = onSubmit.mock.calls[0][0];
    expect(submitted.name).toBe("Hermes");
    expect(submitted.tools).not.toContain("write_file");
    expect(submitted.tools).toContain("read_file");
    expect(submitted.avatar).toEqual(researcher.config.avatar);
  });

  it("blocks save with inline errors for an empty persona", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AgentBuilder
        options={OPTIONS}
        initial={researcher.config}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const persona = screen.getByTestId("builder-persona");
    await user.clear(persona);
    await user.click(screen.getByTestId("builder-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("builder-error-persona").textContent).toMatch(/persona/i);
  });

  it("blocks removing read_file (required by every tool set)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AgentBuilder
        options={OPTIONS}
        initial={researcher.config}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    await user.click(screen.getByTestId("tool-read_file"));
    await user.click(screen.getByTestId("builder-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("builder-error-tools").textContent).toMatch(/read files/i);
  });

  it("emits memory overrides only when set", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AgentBuilder
        options={OPTIONS}
        initial={researcher.config}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    await user.click(screen.getByTestId("memory-custom"));
    await user.clear(screen.getByTestId("memory-trigger"));
    await user.type(screen.getByTestId("memory-trigger"), "12");
    await user.clear(screen.getByTestId("memory-keep"));
    await user.type(screen.getByTestId("memory-keep"), "4");
    await user.click(screen.getByTestId("builder-submit"));

    const submitted: AgentConfigInput = onSubmit.mock.calls[0][0];
    expect(submitted.memory).toEqual({ triggerMessages: 12, keepMessages: 4 });
  });

  it("shows server-side validation errors after a failed save", () => {
    render(
      <AgentBuilder
        options={OPTIONS}
        initial={researcher.config}
        serverErrors={{ model: "Choose a model from the list." }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("builder-error-model").textContent).toContain("model");
  });
});

describe("SettingsPane", () => {
  function makeSettings(hasKey: boolean) {
    return {
      setApiKey: vi.fn(async () => {}),
      hasApiKey: vi.fn(async () => hasKey),
    };
  }

  it("saves an API key through the bridge and reports stored state", async () => {
    const user = userEvent.setup();
    const settings = makeSettings(false);
    render(<SettingsPane settings={settings} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("api-key-status").textContent).toMatch(/not set/i);
    });

    await user.type(screen.getByTestId("api-key-input"), "sk-ant-test-key");
    await user.click(screen.getByTestId("api-key-save"));

    await waitFor(() => {
      expect(settings.setApiKey).toHaveBeenCalledWith("anthropic", "sk-ant-test-key");
    });
    await waitFor(() => {
      expect(screen.getByTestId("api-key-status").textContent).toMatch(/saved/i);
    });
  });

  it("shows configured state when a key exists", async () => {
    const settings = makeSettings(true);
    render(<SettingsPane settings={settings} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId("api-key-status").textContent).toMatch(/configured/i);
    });
  });
});
