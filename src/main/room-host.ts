/**
 * Room host: wires store + session manager + broker into a single
 * main-process façade the IPC layer and (later) quit path can own.
 *
 * Responsibilities:
 * - Build member snapshots with presence + a status line derived from the
 *   latest tool_call (never from tokens).
 * - Push live room events to subscribed renderer windows.
 * - Expose the intents the UI needs: snapshot, post, cancel, retry.
 *
 * Deliberately free of BrowserWindow imports so unit tests can drive it
 * without Electron.
 */
import { join } from "node:path";

import type {
  ActivitySnapshot,
  AgentActivityDto,
  AgentConfigDto,
  AgentFailureDto,
  AgentOptionsDto,
  MemberDto,
  PresenceState,
  RoomMessageDto,
  RoomPushEvent,
  RoomSnapshot,
  SaveAgentResult,
} from "../shared/room-types";
import { ActivityProjector } from "./activity-projector";
import { fsToolAllowlist, resolveExtraTools } from "./agent-config";
import { createRoomAgent } from "./agents/agent-factory";
import {
  SessionManager,
  type AgentFailure,
  type AgentSnapshot,
  type SessionEvent,
  type SessionManagerOptions,
} from "./agents/session-manager";
import { createRoomWorkspace, type RoomWorkspace } from "./agents/workspace";
import { agentAvatar, Broker, type BrokerOptions, type RelevanceGate } from "./broker";
import { RoomStore, type RoomMessage } from "./room-store";
import {
  AGENT_PRESETS,
  DEFAULT_MODEL,
  FS_TOOL_IDS,
  MODEL_OPTIONS,
  TOOL_CATALOG,
  slugifyAgentId,
  validateAgentConfig,
  type AgentConfigInput,
} from "../shared/agent-config";

export interface RoomHostOptions {
  /** SQLite path for the room store (`:memory:` allowed). */
  roomDbPath: string;
  /** Shared jailed workspace directory; agents get file tools rooted here. */
  workspaceDir?: string;
  /** Directory for per-agent checkpoint DBs (persistent memory). */
  checkpointsDir?: string;
  /** Optional session-manager overrides (factory, timeouts) for tests. */
  sessionOptions?: SessionManagerOptions;
  /** Optional broker overrides (gate, caps). */
  brokerOptions?: Omit<BrokerOptions, "store" | "sessions">;
  /** Injected relevance gate (defaults to restrained: nobody chimes in). */
  gate?: RelevanceGate;
}

export type RoomPushListener = (event: RoomPushEvent) => void;

function toMessageDto(message: RoomMessage): RoomMessageDto {
  return {
    id: message.id,
    seq: message.seq,
    authorType: message.authorType,
    authorId: message.authorId,
    authorName: message.authorName,
    text: message.text,
    createdAt: message.createdAt,
    interrupted: message.interrupted || undefined,
    avatar: message.avatar,
  };
}

function toFailureDto(failure: AgentFailure): AgentFailureDto {
  return {
    kind: failure.kind,
    message: failure.message,
    at: failure.at,
    retryable: failure.retryable,
  };
}

function presenceStatusLine(
  presence: PresenceState,
  toolName: string | null,
): string | null {
  switch (presence) {
    case "connecting":
      return "connecting…";
    case "thinking":
      return "thinking…";
    case "runningTool":
      return toolName ? `running ${toolName}…` : "running a tool…";
    case "error":
      return "error";
    case "offline":
      return "offline";
    case "stopped":
      return "stopped";
    case "idle":
    default:
      return null;
  }
}

/**
 * Default on-disk layout under the app userData directory.
 */
export function defaultRoomPaths(userDataDir: string): {
  roomDbPath: string;
  workspaceDir: string;
  checkpointsDir: string;
} {
  return {
    roomDbPath: join(userDataDir, "room.db"),
    workspaceDir: join(userDataDir, "workspace"),
    checkpointsDir: join(userDataDir, "checkpoints"),
  };
}

export class RoomHost {
  readonly store: RoomStore;
  readonly sessions: SessionManager;
  readonly broker: Broker;
  readonly projector: ActivityProjector;
  private readonly workspace: RoomWorkspace | null;
  private readonly checkpointsDir: string | null;

  private readonly listeners = new Set<RoomPushListener>();
  private readonly lastToolByAgent = new Map<string, string | null>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: RoomHostOptions) {
    this.store = new RoomStore(options.roomDbPath);
    this.workspace = options.workspaceDir
      ? createRoomWorkspace(options.workspaceDir)
      : null;
    this.checkpointsDir = options.checkpointsDir ?? null;

    // Production factory: jail agents into the shared workspace and give
    // each its own checkpoint directory. Tests inject their own factory.
    const sessionOptions: SessionManagerOptions = { ...options.sessionOptions };
    if (!sessionOptions.factory && (this.workspace || this.checkpointsDir)) {
      const workspace = this.workspace;
      const checkpointsDir = this.checkpointsDir;
      sessionOptions.factory = (config) =>
        createRoomAgent({
          ...config,
          backend: config.backend ?? workspace?.createBackend(),
          permissions:
            config.permissions ?? (workspace ? [...workspace.permissions] : undefined),
          memoryDir: config.memoryDir ?? checkpointsDir ?? undefined,
        });
    }

    this.sessions = new SessionManager(sessionOptions);
    this.broker = new Broker({
      store: this.store,
      sessions: this.sessions,
      gate: options.gate ?? options.brokerOptions?.gate,
      maxChainDepth: options.brokerOptions?.maxChainDepth,
      maxAgents: options.brokerOptions?.maxAgents,
    });
    this.projector = new ActivityProjector({ store: this.store });

    this.unsubscribers.push(
      this.projector.subscribe((agentId, activity, eventSeq) => {
        this.emit({ type: "activity", agentId, activity, eventSeq });
      }),
    );

    this.unsubscribers.push(
      this.store.subscribeMessages((message) => {
        this.emit({ type: "message", message: toMessageDto(message) });
      }),
    );

    this.unsubscribers.push(
      this.sessions.subscribe((event) => {
        this.handleSessionEvent(event);
      }),
    );
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.listeners.clear();
    this.projector.dispose();
    this.broker.dispose();
    // Session manager shutdown is the caller's responsibility (needs await).
  }

  subscribe(listener: RoomPushListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): RoomSnapshot {
    return {
      messages: this.store.listMessages().map(toMessageDto),
      members: this.listMembers(),
    };
  }

  /**
   * Roster-complete activity view: every member gets an entry —
   * agents without folded events get an idle placeholder — and the
   * high-water mark lets a reloaded renderer dedupe live pushes.
   */
  getActivitySnapshot(): ActivitySnapshot {
    const projected = this.projector.getSnapshot();
    const byAgent = new Map(projected.activities.map((a) => [a.agentId, a]));
    const activities: AgentActivityDto[] = this.listMembers().map((member) => {
      const activity = byAgent.get(member.id);
      if (activity) {
        return { ...activity, agentName: member.name };
      }
      return {
        agentId: member.id,
        agentName: member.name,
        lastActiveAt: null,
        current: null,
        recent: [],
      };
    });
    return { activities, highWaterSeq: projected.highWaterSeq };
  }

  listMembers(): MemberDto[] {
    const live = new Map(
      this.sessions.listAgents().map((s) => [s.id, s] as const),
    );
    return this.store.listAgents().map((agent) => {
      const snap: AgentSnapshot | undefined = live.get(agent.id);
      const presence = (snap?.presence ?? "offline") as PresenceState;
      const toolName = this.lastToolByAgent.get(agent.id) ?? null;
      return {
        id: agent.id,
        name: agent.name,
        persona: agent.persona,
        presence,
        statusLine: presenceStatusLine(presence, toolName),
        lastFailure: snap?.lastFailure ? toFailureDto(snap.lastFailure) : null,
        avatar: agentAvatar(agent),
      };
    });
  }

  async postMessage(text: string): Promise<{ seq: number; chainId: string }> {
    return this.broker.postUserMessage(text);
  }

  cancelTurn(agentId: string): boolean {
    return this.broker.cancelTurn(agentId);
  }

  async retryAgent(agentId: string): Promise<void> {
    await this.sessions.retryAgent(agentId);
    this.emitMember(agentId);
  }

  // ------------------------------------------------------------------
  // Agent lifecycle (create / edit / remove)
  // ------------------------------------------------------------------

  /** Catalog + presets the builder renders from. */
  getAgentOptions(): AgentOptionsDto {
    return { models: MODEL_OPTIONS, tools: TOOL_CATALOG, presets: AGENT_PRESETS };
  }

  /** A stored agent's editable config, for the builder's edit mode. */
  getAgentConfig(agentId: string): AgentConfigDto | null {
    const record = this.store.getAgent(agentId);
    if (!record) return null;
    const config = record.config as {
      model?: string;
      tools?: string[];
      avatar?: AgentConfigInput["avatar"];
      memory?: AgentConfigInput["memory"];
    };
    return {
      id: record.id,
      name: record.name,
      persona: record.persona,
      model: config.model ?? DEFAULT_MODEL,
      tools: config.tools ?? [...FS_TOOL_IDS],
      avatar: config.avatar ?? { emoji: "\u{1F916}", color: "#6ea8fe" },
      memory: config.memory,
    };
  }

  /** Re-register and start every stored agent after an app relaunch. */
  async restoreAgents(): Promise<void> {
    const live = new Set(this.sessions.listAgents().map((s) => s.id));
    const missing = this.store.listAgents().filter((a) => !live.has(a.id));
    for (const agent of missing) {
      const config = agent.config as {
        model?: string;
        tools?: string[];
        memory?: AgentConfigInput["memory"];
      };
      this.sessions.registerAgent({
        id: agent.id,
        name: agent.name,
        model: config.model,
        systemPrompt: agent.persona,
        tools: resolveExtraTools(config.tools ?? []),
        fsTools: config.tools ? fsToolAllowlist(config.tools) : undefined,
        memory: config.memory,
      });
    }
    await this.sessions.startAll();
    if (missing.length > 0) {
      this.emit({ type: "members", members: this.listMembers() });
    }
  }

  /** Validate, persist, register, and start a new agent. */
  async createAgent(input: AgentConfigInput): Promise<SaveAgentResult> {
    const errors = validateAgentConfig(input);
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    const id = slugifyAgentId(input.name, (candidate) => this.store.getAgent(candidate) !== null);
    await this.broker.addAgent({
      id,
      name: input.name.trim(),
      persona: input.persona.trim(),
      model: input.model,
      tools: resolveExtraTools(input.tools),
      fsTools: fsToolAllowlist(input.tools),
      memory: input.memory,
      config: this.storedConfig(input),
    });
    this.emitMember(id);
    const member = this.listMembers().find((m) => m.id === id);
    return member ? { ok: true, member } : { ok: false, errors: { name: "Agent failed to start." } };
  }

  /**
   * Validate and apply an edit. A mid-flight turn finishes on the old
   * config; the next turn uses the new one. Name/avatar changes apply to
   * future messages — history keeps its original attribution.
   */
  async updateAgent(agentId: string, input: AgentConfigInput): Promise<SaveAgentResult> {
    if (!this.store.getAgent(agentId)) {
      return { ok: false, errors: { name: `Unknown agent: ${agentId}` } };
    }
    const errors = validateAgentConfig(input);
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    this.store.updateAgent(agentId, {
      name: input.name.trim(),
      persona: input.persona.trim(),
      config: this.storedConfig(input),
    });
    this.sessions.reconfigure(agentId, {
      name: input.name.trim(),
      systemPrompt: input.persona.trim(),
      model: input.model,
      tools: resolveExtraTools(input.tools),
      fsTools: fsToolAllowlist(input.tools),
      memory: input.memory,
    });
    this.emitMember(agentId);
    const member = this.listMembers().find((m) => m.id === agentId);
    return member ? { ok: true, member } : { ok: false, errors: { name: "Agent update failed." } };
  }

  /**
   * Cancel any in-flight turn, stop and unregister the agent, and drop it
   * from the roster. Its messages stay in history and its checkpoint file
   * stays on disk.
   */
  async removeAgent(agentId: string): Promise<void> {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;
    this.broker.cancelTurn(agentId);
    await this.sessions.stopAgent(agentId);
    this.store.deleteAgent(agentId);
    this.store.appendMessage({
      authorType: "system",
      authorId: "system",
      authorName: "Room",
      text: `${agent.name} was removed from the room. Their messages stay in the history.`,
    });
    this.emit({ type: "members", members: this.listMembers() });
  }

  /** Fields persisted verbatim on the agent record. */
  private storedConfig(input: AgentConfigInput): Record<string, unknown> {
    return {
      model: input.model,
      tools: input.tools,
      avatar: input.avatar,
      memory: input.memory ?? {},
    };
  }

  private handleSessionEvent(event: SessionEvent): void {
    switch (event.type) {
      case "presence": {
        if (event.state === "idle" || event.state === "offline" || event.state === "stopped") {
          this.lastToolByAgent.set(event.agentId, null);
        }
        this.emitMember(event.agentId);
        break;
      }
      case "turn.event": {
        if (event.event.kind === "token") {
          const agent = this.store.getAgent(event.agentId);
          this.emit({
            type: "token",
            agentId: event.agentId,
            agentName: agent?.name ?? event.agentId,
            text: event.event.text,
          });
        } else if (event.event.kind === "tool_call.start") {
          this.lastToolByAgent.set(event.agentId, event.event.name);
          this.emitMember(event.agentId);
        } else if (event.event.kind === "turn.end") {
          this.emit({
            type: "stream-end",
            agentId: event.agentId,
            reason: event.event.reason,
          });
        }
        break;
      }
      case "failure": {
        this.emit({
          type: "failure",
          agentId: event.agentId,
          failure: toFailureDto(event.failure),
        });
        this.emitMember(event.agentId);
        break;
      }
      default:
        break;
    }
  }

  private emitMember(agentId: string): void {
    const member = this.listMembers().find((m) => m.id === agentId);
    if (member) {
      this.emit({ type: "presence", member });
    }
    // Always push the full roster so the UI can't drift on membership.
    this.emit({ type: "members", members: this.listMembers() });
  }

  private emit(event: RoomPushEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
