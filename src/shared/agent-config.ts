/**
 * Agent configuration catalog.
 *
 * Pure data + validation shared by the renderer (inline form feedback) and
 * the main process (authoritative re-validation on save). Keep this module
 * free of Node/Electron/langchain imports so the renderer can bundle it;
 * tool *instances* are resolved main-side in `src/main/agent-config.ts`.
 */

/** Avatar shown on the member list and messages: one emoji + one hex color. */
export interface AgentAvatar {
  emoji: string;
  color: string;
}

/** Per-agent memory overrides; unset fields inherit room defaults. */
export interface AgentMemoryConfig {
  /** Set false to keep full verbatim context (no summarization). */
  summarization?: boolean;
  /** Trigger summarization once history reaches this many messages. */
  triggerMessages?: number;
  /** How many recent messages stay verbatim after summarization. */
  keepMessages?: number;
}

/** The builder's editable agent shape (create and edit share it). */
export interface AgentConfigInput {
  name: string;
  avatar: AgentAvatar;
  persona: string;
  model: string;
  tools: string[];
  memory?: AgentMemoryConfig;
}

export interface ToolSpec {
  id: string;
  label: string;
  description: string;
  /** fs = SDK filesystem built-in (jailed); web = in-repo web tool. */
  kind: "fs" | "web";
}

/**
 * Filesystem built-in ids, mirroring the SDK's FsToolName minus `execute`
 * (no shell ships in v1 — the catalog never offers it).
 */
export const FS_TOOL_IDS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
] as const;

export const TOOL_CATALOG: readonly ToolSpec[] = [
  { id: "read_file", label: "Read files", description: "Read workspace files", kind: "fs" },
  { id: "write_file", label: "Write files", description: "Create workspace files", kind: "fs" },
  { id: "edit_file", label: "Edit files", description: "Modify workspace files", kind: "fs" },
  { id: "ls", label: "List files", description: "List workspace directories", kind: "fs" },
  { id: "glob", label: "Find files", description: "Match files by pattern", kind: "fs" },
  { id: "grep", label: "Search files", description: "Search file contents", kind: "fs" },
  {
    id: "fetch_url",
    label: "Fetch URL",
    description: "Fetch a web page over http(s)",
    kind: "web",
  },
];

export const MODEL_OPTIONS = [
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
] as const;

export const DEFAULT_MODEL = MODEL_OPTIONS[0].id;

export interface AgentPreset {
  id: string;
  label: string;
  blurb: string;
  config: AgentConfigInput;
}

/**
 * Starter presets. Personas carry the restrained chime-in default in
 * text: speak up only when the topic is squarely yours — there is no
 * chattiness setting, personality lives in the persona.
 */
export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: "researcher",
    label: "Researcher",
    blurb: "Tracks down facts and sources, saves notes to the workspace.",
    config: {
      name: "Scout",
      avatar: { emoji: "🔍", color: "#3d8bfd" },
      model: DEFAULT_MODEL,
      tools: ["read_file", "write_file", "ls", "glob", "grep", "fetch_url"],
      persona:
        "You are Scout, the room's researcher. You love facts, sources, and " +
        "well-grounded answers; when you fetch material, you save useful " +
        "notes to the shared workspace. You speak up only when the topic is " +
        "squarely yours — research questions, evidence, and references. When " +
        "a message is not about research, you stay silent, even if nothing " +
        "else is going on. When addressed, answer concisely and cite what " +
        "you found.",
    },
  },
  {
    id: "coder",
    label: "Coder",
    blurb: "Reads and edits code in the workspace; no shell access.",
    config: {
      name: "Ada",
      avatar: { emoji: "🛠️", color: "#7fd99a" },
      model: DEFAULT_MODEL,
      tools: ["read_file", "write_file", "edit_file", "ls", "glob", "grep"],
      persona:
        "You are Ada, the room's coder. You work through files in the " +
        "shared workspace: read, write, and edit code, and search the tree " +
        "before changing anything. You have no shell — when something needs " +
        "to build, run, or test, ask the user in-room to run it and paste " +
        "the output, then continue from there. You speak up only when the " +
        "topic is squarely yours — code, debugging, and design. On anything " +
        "else you stay silent.",
    },
  },
  {
    id: "writer",
    label: "Writer",
    blurb: "Drafts and polishes prose in workspace documents.",
    config: {
      name: "Muse",
      avatar: { emoji: "✍️", color: "#b48cff" },
      model: DEFAULT_MODEL,
      tools: ["read_file", "write_file", "ls", "glob"],
      persona:
        "You are Muse, the room's writer. You draft and polish prose in the " +
        "shared workspace: tight sentences, clear structure, consistent " +
        "tone. You speak up only when the topic is squarely yours — " +
        "writing, editing, and voice. On anything else you stay silent.",
    },
  },
];

export type ValidationErrors = Partial<
  Record<"name" | "avatar" | "persona" | "model" | "tools" | "memory", string>
>;

const MAX_NAME_LENGTH = 40;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Inline + authoritative validation; an empty result means valid. */
export function validateAgentConfig(input: AgentConfigInput): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    errors.name = `Name is required (up to ${MAX_NAME_LENGTH} characters).`;
  }

  if (!input.avatar.emoji.trim() || !COLOR_RE.test(input.avatar.color)) {
    errors.avatar = "Pick an emoji and a color.";
  }

  if (input.persona.trim().length === 0) {
    errors.persona = "Persona/instructions are required.";
  }

  if (!MODEL_OPTIONS.some((m) => m.id === input.model)) {
    errors.model = "Choose a model from the list.";
  }

  const catalogIds = new Set(TOOL_CATALOG.map((t) => t.id));
  if (input.tools.length === 0) {
    errors.tools = "Select at least one tool.";
  } else if (input.tools.some((t) => !catalogIds.has(t))) {
    errors.tools = "One or more selected tools are not allowed.";
  } else if (!input.tools.includes("read_file")) {
    // The SDK requires read_file in every explicit filesystem allowlist.
    errors.tools = "Read files must stay selected.";
  }

  const memory = input.memory;
  if (memory) {
    const { triggerMessages, keepMessages } = memory;
    if (
      (triggerMessages !== undefined && (!Number.isInteger(triggerMessages) || triggerMessages < 1)) ||
      (keepMessages !== undefined && (!Number.isInteger(keepMessages) || keepMessages < 1))
    ) {
      errors.memory = "Memory thresholds must be positive whole numbers.";
    } else if (
      triggerMessages !== undefined &&
      keepMessages !== undefined &&
      keepMessages >= triggerMessages
    ) {
      errors.memory = "Keep must be smaller than the summarization trigger.";
    }
  }

  return errors;
}

/** Slug a display name into a stable agent id, deduped against `isTaken`. */
export function slugifyAgentId(name: string, isTaken: (id: string) => boolean): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  if (!isTaken(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!isTaken(candidate)) return candidate;
  }
}
