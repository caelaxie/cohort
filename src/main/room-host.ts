/**
 * Room host (U6): wires store + session manager + broker into a single
 * main-process façade the IPC layer and (later) quit path can own.
 *
 * Responsibilities:
 * - Build member snapshots with presence + a status line derived from the
 *   latest tool_call (never from tokens — R5).
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
  AgentFailureDto,
  MemberDto,
  PresenceState,
  RoomMessageDto,
  RoomPushEvent,
  RoomSnapshot,
} from "../shared/room-types";
import { ActivityProjector } from "./activity-projector";
import {
  SessionManager,
  type AgentFailure,
  type AgentSnapshot,
  type SessionEvent,
  type SessionManagerOptions,
} from "./agents/session-manager";
import { Broker, type BrokerOptions, type RelevanceGate } from "./broker";
import { RoomStore, type RoomMessage } from "./room-store";

export interface RoomHostOptions {
  /** SQLite path for the room store (`:memory:` allowed). */
  roomDbPath: string;
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

  private readonly listeners = new Set<RoomPushListener>();
  private readonly lastToolByAgent = new Map<string, string | null>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: RoomHostOptions) {
    this.store = new RoomStore(options.roomDbPath);
    this.sessions = new SessionManager(options.sessionOptions);
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
   * Roster-complete activity view (U7): every member gets an entry —
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
