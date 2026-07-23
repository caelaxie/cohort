/**
 * Agent factory — the seam between Agent Room configuration and the
 * `deepagents` SDK (agents are `createDeepAgent` instances living in
 * the Electron main process).
 *
 * The wrapper translates a plain config object into a `DeepAgent` and
 * re-exports the instance type so downstream units (turn runner, room
 * broker) never import `deepagents` directly.
 *
 * Memory: when `id` and `memoryDir` are set, the agent gets a
 * SQLite checkpointer (`SqliteSaver`, one DB file per agent) and a stable
 * `thread_id` (`roomThreadId`), so a relaunched agent resumes from its
 * checkpointed history. The SDK's default `SummarizationMiddleware` keeps
 * recent messages verbatim and summarizes older ones; `memory` carries the
 * per-agent overrides — a same-named custom middleware replaces the
 * default in the SDK's merge, so the override plumbing is the SDK's own.
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  createDeepAgent,
  createFilesystemMiddleware,
  createSummarizationMiddleware,
  StateBackend,
  type BackendRuntime,
  type CreateDeepAgentParams,
  type DeepAgent,
  type FsToolName,
} from "deepagents";

/**
 * Per-agent memory overrides. Room-level defaults apply when unset;
 * these fields tune or disable the default summarization behavior.
 */
export interface RoomMemoryOverrides {
  /**
   * Set to `false` to keep full verbatim context (no summarization).
   * Defaults to enabled.
   */
  summarization?: boolean;
  /**
   * Trigger summarization once the history reaches this many messages.
   * A tiny value forces summarization early (useful in tests).
   */
  triggerMessages?: number;
  /** How many recent messages stay verbatim after summarization. */
  keepMessages?: number;
}

/**
 * Plain configuration for a single room agent.
 *
 * Most fields are forwarded verbatim to `createDeepAgent`:
 * - `model` — provider string (e.g. "claude-sonnet-4-5-20250929") or a
 *   `BaseChatModel` instance (e.g. the stub model used in tests).
 * - `systemPrompt` — persona/system instructions.
 * - `tools` — extra tools beyond the deep-agent built-ins.
 * - `backend` — file-tool backend (the shared room workspace).
 * - `checkpointer` — explicit persistence override; when omitted and both
 *   `id` and `memoryDir` are set, a `SqliteSaver` is created at
 *   `agentCheckpointPath(memoryDir, id)`.
 * - `permissions` — workspace permission rules.
 * - `memory` — per-agent memory overrides.
 * - `name` — agent name surfaced in the graph.
 */
export interface RoomAgentConfig {
  /** Stable agent id; drives the checkpoint filename and thread_id. */
  id?: string;
  model?: CreateDeepAgentParams["model"];
  systemPrompt?: CreateDeepAgentParams["systemPrompt"];
  tools?: CreateDeepAgentParams["tools"];
  backend?: CreateDeepAgentParams["backend"];
  checkpointer?: CreateDeepAgentParams["checkpointer"];
  permissions?: CreateDeepAgentParams["permissions"];
  /**
   * Directory holding per-agent checkpoint DBs. Injectable so tests (and
   * the app at launch) decide where memory lives — no Electron imports here.
   */
  memoryDir?: string;
  memory?: RoomMemoryOverrides;
  /** Filesystem built-in allowlist; undefined keeps the SDK default set. */
  fsTools?: readonly FsToolName[];
  name?: string;
}

/** The agent type the rest of the app codes against. */
export type RoomAgent = DeepAgent;

type AnyMiddleware = NonNullable<CreateDeepAgentParams["middleware"]>[number];

/** Stable LangGraph thread id for an agent (agent id + fixed suffix). */
export function roomThreadId(agentId: string): string {
  return `${agentId}:room`;
}

/** Checkpoint DB path for an agent inside the room's memory directory. */
export function agentCheckpointPath(memoryDir: string, agentId: string): string {
  // Agent ids are app-generated slugs; strip path separators defensively so
  // an id can never escape the memory directory.
  const safe = agentId.replace(/[/\\]/g, "_");
  return join(memoryDir, `${safe}.checkpoint.sqlite`);
}

/**
 * Validate an agent's checkpoint DB at startup. Returns a notice string the
 * caller can post to chat when recovery happened, or `undefined` when the DB
 * is healthy (or does not exist yet).
 *
 * On corruption the unreadable file is renamed aside (never deleted) and the
 * agent starts a fresh thread against a new DB at the original path.
 */
export async function validateAgentCheckpoint(
  dbPath: string,
): Promise<string | undefined> {
  if (!existsSync(dbPath)) return undefined;
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      // quick_check throws (or reports corruption) on a damaged file without
      // paying for a full integrity scan.
      db.pragma("quick_check");
    } finally {
      db.close();
    }
    return undefined;
  } catch (err) {
    const backupPath = `${dbPath}.corrupt-${Date.now()}`;
    renameSync(dbPath, backupPath);
    const detail = err instanceof Error ? err.message : String(err);
    return (
      "An agent's memory file was corrupted and could not be opened " +
      `(${detail}). It was backed up to ${backupPath} and the agent is ` +
      "starting with fresh memory."
    );
  }
}

/**
 * Wrap the agent's invocation methods so every call runs on the agent's
 * stable thread. A caller-supplied `thread_id` always wins.
 */
function withStableThread(agent: RoomAgent, threadId: string): RoomAgent {
  const mergeConfig = <T>(config: T): T => {
    const c = (config ?? {}) as Record<string, unknown>;
    return {
      ...c,
      configurable: { thread_id: threadId, ...(c.configurable as object) },
    } as T;
  };
  const stream = agent.stream.bind(agent);
  agent.stream = ((input: unknown, config?: unknown) =>
    stream(input as never, mergeConfig(config) as never)) as RoomAgent["stream"];
  const invoke = agent.invoke.bind(agent);
  agent.invoke = ((input: unknown, config?: unknown) =>
    invoke(input as never, mergeConfig(config) as never)) as RoomAgent["invoke"];
  return agent;
}

/** Summarization middleware honoring the per-agent overrides. */
function memoryMiddleware(config: RoomAgentConfig): AnyMiddleware[] {
  const memory = config.memory;
  if (!memory) return [];
  const hasTuning =
    memory.triggerMessages != null || memory.keepMessages != null;
  if (memory.summarization !== false && !hasTuning) return [];
  // Mirror the SDK default backend when none is configured; a same-named
  // middleware replaces the default SummarizationMiddleware in the merge.
  const backend =
    config.backend ?? ((runtime: BackendRuntime) => new StateBackend(runtime));
  if (memory.summarization === false) {
    // Disabled: an unreachable trigger means history stays fully verbatim.
    return [
      createSummarizationMiddleware({
        backend,
        trigger: { type: "messages", value: Number.MAX_SAFE_INTEGER },
      }),
    ];
  }
  return [
    createSummarizationMiddleware({
      backend,
      ...(memory.triggerMessages != null
        ? { trigger: { type: "messages" as const, value: memory.triggerMessages } }
        : {}),
      ...(memory.keepMessages != null
        ? { keep: { type: "messages" as const, value: memory.keepMessages } }
        : {}),
    }),
  ];
}

/**
 * Create a room agent from plain config.
 *
 * Note: when `model` is omitted, `createDeepAgent` falls back to its
 * default provider string, which requires the matching provider package
 * and credentials at runtime. Tests and offline flows must pass a model
 * instance (see `stub-model.ts`).
 */
export function createRoomAgent(config: RoomAgentConfig = {}): RoomAgent {
  let checkpointer = config.checkpointer;
  if (!checkpointer && config.id && config.memoryDir) {
    mkdirSync(config.memoryDir, { recursive: true });
    checkpointer = SqliteSaver.fromConnString(
      agentCheckpointPath(config.memoryDir, config.id),
    );
  }
  const middleware: AnyMiddleware[] = [];
  if (config.fsTools) {
    // Tool sets: a same-named filesystem middleware replaces the SDK's
    // default in its merge, narrowing the built-ins to the agent's
    // allowlist (`execute` is never in the catalog).
    middleware.push(
      createFilesystemMiddleware({
        backend: config.backend ?? ((runtime: BackendRuntime) => new StateBackend(runtime)),
        tools: config.fsTools,
        permissions: config.permissions,
      }),
    );
  }
  middleware.push(...memoryMiddleware(config));
  // Pass the literal directly so `createDeepAgent`'s generics infer from the
  // values; the interface default for `ContextSchema` differs from the
  // function's and breaks assignment of a pre-typed params object.
  const agent = createDeepAgent({
    model: config.model,
    systemPrompt: config.systemPrompt,
    tools: config.tools,
    backend: config.backend,
    checkpointer,
    permissions: config.permissions,
    middleware,
    name: config.name,
  });
  return config.id ? withStableThread(agent, roomThreadId(config.id)) : agent;
}
