/**
 * Agent factory — the seam between Agent Room configuration and the
 * `deepagents` SDK (KTD1: agents are `createDeepAgent` instances living in
 * the Electron main process).
 *
 * The wrapper is intentionally thin: it translates a plain config object
 * into a `DeepAgent` and re-exports the instance type so downstream units
 * (turn runner, room broker) never import `deepagents` directly.
 */
import {
  createDeepAgent,
  type CreateDeepAgentParams,
  type DeepAgent,
} from "deepagents";

/**
 * Plain configuration for a single room agent.
 *
 * All fields are optional and forwarded verbatim to `createDeepAgent`:
 * - `model` — provider string (e.g. "claude-sonnet-4-5-20250929") or a
 *   `BaseChatModel` instance (e.g. the stub model used in tests).
 * - `systemPrompt` — persona/system instructions.
 * - `tools` — extra tools beyond the deep-agent built-ins.
 * - `backend` / `checkpointer` — persistence seams owned by later units.
 * - `name` — agent name surfaced in the graph.
 */
export interface RoomAgentConfig {
  model?: CreateDeepAgentParams["model"];
  systemPrompt?: CreateDeepAgentParams["systemPrompt"];
  tools?: CreateDeepAgentParams["tools"];
  backend?: CreateDeepAgentParams["backend"];
  checkpointer?: CreateDeepAgentParams["checkpointer"];
  name?: string;
}

/** The agent type the rest of the app codes against. */
export type RoomAgent = DeepAgent;

/**
 * Create a room agent from plain config.
 *
 * Note: when `model` is omitted, `createDeepAgent` falls back to its
 * default provider string, which requires the matching provider package
 * and credentials at runtime. Tests and offline flows must pass a model
 * instance (see `stub-model.ts`).
 */
export function createRoomAgent(config: RoomAgentConfig = {}): RoomAgent {
  // Pass the literal directly so `createDeepAgent`'s generics infer from the
  // values; the interface default for `ContextSchema` differs from the
  // function's and breaks assignment of a pre-typed params object.
  return createDeepAgent({
    model: config.model,
    systemPrompt: config.systemPrompt,
    tools: config.tools,
    backend: config.backend,
    checkpointer: config.checkpointer,
    name: config.name,
  });
}
