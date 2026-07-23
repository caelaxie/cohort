/**
 * Invocation broker (U4; R1–R4, R12, R13; F2, F4; KTD4, KTD5, KTD8, KTD16):
 * the routing brain that decides who speaks when.
 *
 * Responsibilities:
 * - Appends every user message to the room store (the only history anyone
 *   reads) and routes it: an @mention targets exactly one agent; an
 *   unaddressed message goes through the relevance gate (KTD8) which judges
 *   each agent against ITS OWN PERSONA as the rubric. Only opted-in agents
 *   are invoked. The gate is injectable so tests never touch a live model.
 * - Per-agent FIFO with no preemption (KTD5): messages for a busy agent
 *   accumulate and fold into its NEXT turn input, delivered together and in
 *   order. Built on top of the session manager's per-agent serialization.
 * - Bounded agent→agent chains (KTD5, R12): an agent reply that @mentions
 *   another member may trigger that member, capped at depth 3 per user
 *   message. The budget binds chains regardless of whether the chain began
 *   from a mention turn or a chime-in turn — chime-ins do not reset it.
 *   Hitting the cap writes a subtle system note to the store. An agent reply
 *   @mentioning a NON-EXISTENT member is dropped with a system note and
 *   consumes no budget. Agent replies never go through the chime-in gate —
 *   only user messages and explicit @mentions trigger agents (R12).
 * - Replay: each agent has a last-delivered watermark in the store; every
 *   invocation delivers everything since the watermark, with messages that
 *   arrived while the agent was away marked as missed (KTD4).
 * - Every invocation input carries the room-context envelope (KTD16): the
 *   member roster (names + one-line personas) and author-attributed messages,
 *   so agents can tell Scout from Muse from the user.
 * - Cancellation: `cancelTurn` passes through to the session manager and
 *   records the interruption as a first-class system entry in the store.
 *
 * The room-context envelope builder is exported here; U5's
 * `src/main/agents/room-context.ts` reuses this framing for live turns and
 * checkpoint replay alike.
 */
import type { BaseMessageLike } from "@langchain/core/messages";

import type {
  InterruptionMarker,
  SessionManager,
  TurnOutcome,
} from "./agents/session-manager";
import { firstMentionName, resolveMention } from "./mentions";
import type { RoomAgentRecord, RoomStore } from "./room-store";

/** Hard caps from KTD5. */
export const MAX_CHAIN_DEPTH = 3;
export const MAX_AGENTS = 8;

/** Marker appended to the author line of messages delivered late. */
export const MISSED_MARKER = "missed while you were away";

// ---------------------------------------------------------------------------
// Room-context envelope (KTD16)
// ---------------------------------------------------------------------------

export interface EnvelopeMessage {
  authorName: string;
  text: string;
  /** True for messages that occurred while the agent was away/busy. */
  missed?: boolean;
}

export interface RoomContextEnvelopeInput {
  /** Name of the agent being invoked — the envelope is addressed to it. */
  selfName: string;
  /** Room members: names plus one-line personas. */
  roster: readonly { name: string; persona: string }[];
  /** Author-attributed messages in sequence order. */
  messages: readonly EnvelopeMessage[];
}

/**
 * Build the room-context envelope: a roster block plus author-attributed
 * "Name: message" lines. U5 reuses this exact framing for replay.
 */
export function buildRoomContext(input: RoomContextEnvelopeInput): string {
  const rosterLines = input.roster.map(
    (member) => `- ${member.name} — ${member.persona}`,
  );
  const messageLines = input.messages.map(
    (m) => `${m.authorName}${m.missed ? ` (${MISSED_MARKER})` : ""}: ${m.text}`,
  );
  return [
    `You are ${input.selfName}, a member of a shared chat room.`,
    "",
    "[Room roster]",
    ...rosterLines,
    "- User — the human participant",
    "",
    "[Room messages]",
    ...messageLines,
    "",
    "Reply to the room. Address a specific member with @Name.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Relevance gate (KTD8)
// ---------------------------------------------------------------------------

export interface RelevanceGateInput {
  /** The candidate agent; its persona is the relevance rubric. */
  agent: RoomAgentRecord;
  /** The unaddressed user message text. */
  message: string;
}

/**
 * Cheap relevance judgment for unaddressed messages. Production wires a fast
 * model prompted with the agent's persona; tests stub it. The DEFAULT gate
 * opts nobody in (restrained by default, R13).
 */
export type RelevanceGate = (input: RelevanceGateInput) => boolean | Promise<boolean>;

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

export interface BrokerAgentConfig {
  id: string;
  name: string;
  persona: string;
  model?: Parameters<SessionManager["registerAgent"]>[0]["model"];
  systemPrompt?: string;
  tools?: Parameters<SessionManager["registerAgent"]>[0]["tools"];
  /** Extra config persisted verbatim in the store (memory overrides, ...). */
  config?: Record<string, unknown>;
}

export interface BrokerOptions {
  store: RoomStore;
  sessions: SessionManager;
  gate?: RelevanceGate;
  maxChainDepth?: number;
  maxAgents?: number;
}

interface ChainContext {
  /** Identifies the user message this chain belongs to. */
  id: string;
  /** Depth of the turn this context belongs to (user-routed turns are 1). */
  depth: number;
}

interface PendingTurn {
  /** Store seqs of the messages that triggered this turn. */
  triggerSeqs: number[];
  chain: ChainContext;
}

interface AgentQueueState {
  id: string;
  pending: PendingTurn[];
  draining: Promise<void> | null;
}

export class Broker {
  private readonly store: RoomStore;
  private readonly sessions: SessionManager;
  private readonly gate: RelevanceGate;
  private readonly maxChainDepth: number;
  private readonly maxAgents: number;

  private readonly queues = new Map<string, AgentQueueState>();
  private readonly tokenBuffers = new Map<string, string[]>();
  private readonly activeTurnIds = new Map<string, string>();
  /** Deepest depth dispatched per chain — diagnostic for tests and the UI. */
  private readonly chainDepths = new Map<string, number>();
  private turnCounter = 0;
  private readonly unsubscribe: () => void;

  constructor(options: BrokerOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.gate = options.gate ?? (() => false);
    this.maxChainDepth = options.maxChainDepth ?? MAX_CHAIN_DEPTH;
    this.maxAgents = options.maxAgents ?? MAX_AGENTS;

    // Record raw turn events, assemble reply text, and surface failures.
    this.unsubscribe = this.sessions.subscribe((event) => {
      if (event.type === "failure") {
        this.surfaceFailure(event.agentId, event.failure);
        return;
      }
      if (event.type !== "turn.event") return;
      this.store.appendEvent({
        agentId: event.agentId,
        kind: event.event.kind,
        payload: event.event,
        turnId: this.activeTurnIds.get(event.agentId) ?? null,
      });
      if (event.event.kind === "token") {
        const buffer = this.tokenBuffers.get(event.agentId) ?? [];
        buffer.push(event.event.text);
        this.tokenBuffers.set(event.agentId, buffer);
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  // ------------------------------------------------------------------
  // Membership (cap: KTD5)
  // ------------------------------------------------------------------

  /** Add an agent to the room. Refused once the membership cap is reached. */
  async addAgent(config: BrokerAgentConfig): Promise<void> {
    if (this.store.countAgents() >= this.maxAgents) {
      throw new Error(
        `room membership is capped at ${this.maxAgents} agents; ` +
          `remove an agent before adding "${config.name}"`,
      );
    }
    if (this.store.getAgent(config.id)) {
      throw new Error(`agent already exists: ${config.id}`);
    }
    this.store.addAgent({
      id: config.id,
      name: config.name,
      persona: config.persona,
      config: config.config ?? {},
    });
    this.sessions.registerAgent({
      id: config.id,
      name: config.name,
      model: config.model,
      systemPrompt: config.systemPrompt ?? config.persona,
      tools: config.tools,
    });
    await this.sessions.start(config.id);
  }

  listAgents(): RoomAgentRecord[] {
    return this.store.listAgents();
  }

  // ------------------------------------------------------------------
  // User messages and routing
  // ------------------------------------------------------------------

  /**
   * Append a user message to the store and route it. Returns the stored
   * message seq and the chain id all resulting turns belong to.
   */
  async postUserMessage(
    text: string,
    options: { authorName?: string } = {},
  ): Promise<{ seq: number; chainId: string }> {
    const record = this.store.appendMessage({
      authorType: "user",
      authorId: "user",
      authorName: options.authorName ?? "User",
      text,
    });
    const chainId = `user-${record.seq}`;
    this.chainDepths.set(chainId, 0);
    const roster = this.store.listAgents();

    const mentionName = firstMentionName(text);
    if (mentionName) {
      const target = resolveMention(mentionName, roster);
      if (!target) {
        this.appendSystemNote(
          `No room member named "${mentionName}"; the message was not delivered.`,
        );
        return { seq: record.seq, chainId };
      }
      // Mentioned agent answers; everyone else replays the message later.
      this.dispatch(target.id, [record.seq], { id: chainId, depth: 1 });
      return { seq: record.seq, chainId };
    }

    // Unaddressed: relevance gate with each agent's persona as the rubric.
    for (const agent of roster) {
      if (await this.gate({ agent, message: text })) {
        this.dispatch(agent.id, [record.seq], { id: chainId, depth: 1 });
      }
    }
    return { seq: record.seq, chainId };
  }

  /**
   * Resolve once every queued and in-flight turn has settled (including
   * chained turns triggered by agent replies). Test and shutdown affordance.
   */
  async idle(): Promise<void> {
    for (;;) {
      const drains = [...this.queues.values()]
        .map((q) => q.draining)
        .filter((d): d is Promise<void> => d !== null);
      const pending = [...this.queues.values()].some((q) => q.pending.length > 0);
      if (drains.length === 0 && !pending) return;
      await Promise.all(drains);
    }
  }

  /** Deepest chain depth dispatched for a user message (0 = none yet). */
  getChainDepth(chainId: string): number {
    return this.chainDepths.get(chainId) ?? 0;
  }

  // ------------------------------------------------------------------
  // Cancellation and interruptions
  // ------------------------------------------------------------------

  /**
   * Cancel an agent's in-flight turn (session-manager passthrough). The
   * interruption is recorded as a first-class system entry in the store.
   */
  cancelTurn(agentId: string): boolean {
    const cancelled = this.sessions.cancelTurn(agentId);
    if (cancelled) {
      const name = this.store.getAgent(agentId)?.name ?? agentId;
      this.appendSystemNote(`Interrupted: ${name}'s turn was cancelled.`);
    }
    return cancelled;
  }

  /** Persist a shutdown interruption marker (KTD7) as a system entry. */
  recordInterruption(marker: InterruptionMarker): void {
    this.appendSystemNote(
      `Interrupted: ${marker.agentName} was ${marker.interruptedFrom} when the ` +
        `app shut down (${marker.queuedMessages} message(s) still queued).`,
    );
  }

  // ------------------------------------------------------------------
  // Internals: FIFO queues and turn execution
  // ------------------------------------------------------------------

  private appendSystemNote(text: string): void {
    this.store.appendMessage({
      authorType: "system",
      authorId: "system",
      authorName: "Room",
      text,
    });
  }

  /** Write a chat-visible failure note (F5); auth gets a distinct surface. */
  private surfaceFailure(
    agentId: string,
    failure: { kind: string; message: string; retryable: boolean },
  ): void {
    const name = this.store.getAgent(agentId)?.name ?? agentId;
    if (failure.kind === "auth") {
      this.appendSystemNote(
        `${name} can't reach the model — check the API key.` +
          (failure.retryable ? " Retry when ready." : ""),
      );
      return;
    }
    const hint = failure.retryable ? " Tap retry to bring them back." : "";
    this.appendSystemNote(`${name} hit an error: ${failure.message}.${hint}`);
  }

  private dispatch(agentId: string, triggerSeqs: number[], chain: ChainContext): void {
    const current = this.chainDepths.get(chain.id) ?? 0;
    this.chainDepths.set(chain.id, Math.max(current, chain.depth));
    const state = this.queueState(agentId);
    state.pending.push({ triggerSeqs, chain });
    this.ensureDrain(state);
  }

  private queueState(agentId: string): AgentQueueState {
    let state = this.queues.get(agentId);
    if (!state) {
      state = { id: agentId, pending: [], draining: null };
      this.queues.set(agentId, state);
    }
    return state;
  }

  /**
   * Per-agent FIFO with no preemption: one drain loop per agent; everything
   * that arrived while a turn was in flight folds into the next turn input.
   */
  private ensureDrain(state: AgentQueueState): void {
    if (state.draining) return;
    state.draining = (async () => {
      try {
        while (state.pending.length > 0) {
          const items = state.pending.splice(0);
          const batch: PendingTurn = {
            triggerSeqs: items.flatMap((item) => item.triggerSeqs),
            // A folded batch continues the chain of its most recent trigger.
            chain: items[items.length - 1].chain,
          };
          await this.runTurn(state.id, batch);
        }
      } finally {
        state.draining = null;
      }
    })();
  }

  private async runTurn(agentId: string, batch: PendingTurn): Promise<void> {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;

    // Deliver everything since the watermark; messages older than the
    // current trigger occurred while the agent was away or busy.
    const watermark = this.store.getLastDeliveredSeq(agentId);
    const fresh = this.store.listMessages({ afterSeq: watermark });
    const minTriggerSeq = Math.min(...batch.triggerSeqs);
    const envelope = buildRoomContext({
      selfName: agent.name,
      roster: this.store.listAgents(),
      messages: fresh.map((m) => ({
        authorName: m.authorName,
        text: m.text,
        missed: m.seq < minTriggerSeq,
      })),
    });
    const messages: BaseMessageLike[] = [{ role: "user", content: envelope }];

    const turnId = `turn-${++this.turnCounter}`;
    this.activeTurnIds.set(agentId, turnId);
    let outcome: TurnOutcome;
    try {
      outcome = await this.sessions.sendTurn(agentId, messages);
    } finally {
      this.activeTurnIds.delete(agentId);
    }
    const reply = (this.tokenBuffers.get(agentId) ?? []).join("");
    this.tokenBuffers.delete(agentId);

    if (outcome.reason === "cancelled") {
      // Keep any partial reply in history with an interrupted marker (U6/F5).
      // Watermark stays put so undelivered triggers replay next invocation.
      if (reply.trim()) {
        this.store.appendMessage({
          authorType: "agent",
          authorId: agent.id,
          authorName: agent.name,
          text: reply,
          interrupted: true,
        });
      }
      return;
    }

    if (outcome.reason !== "done") {
      // Failed turns leave the watermark alone so the messages replay next.
      return;
    }

    // Advance the watermark over the contiguous prefix this turn delivered:
    // everything in `fresh`, plus the agent's own reply when nothing
    // undelivered sits between them (the agent has seen its own words).
    let newest = fresh.length > 0 ? fresh[fresh.length - 1].seq : watermark;

    // The reply joins the room record; an explicit @mention in it may
    // trigger the target, bounded by the chain budget.
    if (reply.trim()) {
      const record = this.store.appendMessage({
        authorType: "agent",
        authorId: agent.id,
        authorName: agent.name,
        text: reply,
      });
      if (record.seq === newest + 1) newest = record.seq;
      this.store.setLastDeliveredSeq(agentId, newest);
      this.routeAgentMention(agent, reply, record.seq, batch.chain);
      return;
    }
    this.store.setLastDeliveredSeq(agentId, newest);
  }

  private routeAgentMention(
    author: RoomAgentRecord,
    replyText: string,
    replySeq: number,
    chain: ChainContext,
  ): void {
    const mentionName = firstMentionName(replyText);
    if (!mentionName) return;
    const target = resolveMention(mentionName, this.store.listAgents());
    if (!target) {
      // Dropped; no chain budget is consumed for non-existent members.
      this.appendSystemNote(
        `${author.name} addressed @${mentionName}, but no room member has ` +
          `that name; the mention was dropped.`,
      );
      return;
    }
    if (target.id === author.id) return; // self-mentions never retrigger
    const nextDepth = chain.depth + 1;
    if (nextDepth > this.maxChainDepth) {
      this.appendSystemNote(
        `This conversation's mention chain hit the depth limit ` +
          `(${this.maxChainDepth}); @${target.name} was not invoked.`,
      );
      return;
    }
    this.dispatch(target.id, [replySeq], { id: chain.id, depth: nextDepth });
  }
}
