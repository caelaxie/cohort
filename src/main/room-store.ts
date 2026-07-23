/**
 * Room store (U4; R1, R4, KTD4): the persistent source of truth for the room.
 *
 * Everything the UI will read lives here — messages (including system notes
 * and interruption markers), the agent roster, and the raw per-agent turn
 * events that later feed the activity rail. Per-agent memory is a DERIVED
 * view of this history (KTD4): each agent replays what it missed from the
 * store's sequence numbers, tracked via a per-agent "last delivered"
 * watermark in the meta table.
 *
 * Implementation notes:
 * - `better-sqlite3`, fully synchronous, WAL mode. One connection; sequence
 *   numbers are assigned from `MAX(seq) + 1` per table, which is race-free
 *   because all access is serialized on this connection.
 * - `seq` is monotonic per table and is the ordering the UI and the replay
 *   logic rely on. `id` is the rowid; `seq` survives future compaction.
 * - Pass `":memory:"` for tests; pass a file path for the real room.
 */
import Database from "better-sqlite3";

export type AuthorType = "user" | "agent" | "system";

export interface RoomMessage {
  id: number;
  seq: number;
  authorType: AuthorType;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
  /** True when this is a partial agent reply kept after cancellation. */
  interrupted: boolean;
}

export interface RoomAgentRecord {
  id: string;
  name: string;
  persona: string;
  /** Free-form agent configuration (model, tools, memory overrides). */
  config: Record<string, unknown>;
}

export interface RoomEventRecord {
  id: number;
  seq: number;
  agentId: string;
  kind: string;
  payload: unknown;
  turnId: string | null;
  createdAt: number;
}

export interface AppendMessageInput {
  authorType: AuthorType;
  authorId: string;
  authorName: string;
  text: string;
  createdAt?: number;
  interrupted?: boolean;
}

export interface AppendEventInput {
  agentId: string;
  kind: string;
  payload: unknown;
  turnId?: string | null;
  createdAt?: number;
}

interface MessageRow {
  id: number;
  seq: number;
  author_type: string;
  author_id: string;
  author_name: string;
  text: string;
  created_at: number;
  interrupted: number;
}

interface EventRow {
  id: number;
  seq: number;
  agent_id: string;
  kind: string;
  payload: string;
  turn_id: string | null;
  created_at: number;
}

interface AgentRow {
  id: string;
  name: string;
  persona: string;
  config: string;
}

function toMessage(row: MessageRow): RoomMessage {
  return {
    id: row.id,
    seq: row.seq,
    authorType: row.author_type as AuthorType,
    authorId: row.author_id,
    authorName: row.author_name,
    text: row.text,
    createdAt: row.created_at,
    interrupted: Boolean(row.interrupted),
  };
}

function toEvent(row: EventRow): RoomEventRecord {
  return {
    id: row.id,
    seq: row.seq,
    agentId: row.agent_id,
    kind: row.kind,
    payload: JSON.parse(row.payload) as unknown,
    turnId: row.turn_id,
    createdAt: row.created_at,
  };
}

function toAgent(row: AgentRow): RoomAgentRecord {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    config: JSON.parse(row.config) as Record<string, unknown>,
  };
}

const LAST_DELIVERED_PREFIX = "lastDelivered:";

export type MessageListener = (message: RoomMessage) => void;
export type EventListener = (event: RoomEventRecord) => void;

export class RoomStore {
  private readonly db: Database.Database;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly eventListeners = new Set<EventListener>();

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL UNIQUE,
        author_type TEXT NOT NULL CHECK (author_type IN ('user', 'agent', 'system')),
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        interrupted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        persona TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        turn_id TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    // Upgrade pre-U6 DBs that lack the interrupted column.
    const cols = this.db.prepare("PRAGMA table_info(messages)").all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "interrupted")) {
      this.db.exec(
        "ALTER TABLE messages ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  close(): void {
    this.messageListeners.clear();
    this.eventListeners.clear();
    this.db.close();
  }

  /** Subscribe to newly appended messages. Returns unsubscribe. */
  subscribeMessages(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  /** Subscribe to newly appended turn events (U7 activity projection). */
  subscribeEvents(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  appendMessage(input: AppendMessageInput): RoomMessage {
    const seq = this.nextSeq("messages");
    const createdAt = input.createdAt ?? Date.now();
    const interrupted = input.interrupted ? 1 : 0;
    const info = this.db
      .prepare(
        `INSERT INTO messages (seq, author_type, author_id, author_name, text, created_at, interrupted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq,
        input.authorType,
        input.authorId,
        input.authorName,
        input.text,
        createdAt,
        interrupted,
      );
    const message: RoomMessage = {
      id: Number(info.lastInsertRowid),
      seq,
      authorType: input.authorType,
      authorId: input.authorId,
      authorName: input.authorName,
      text: input.text,
      createdAt,
      interrupted: Boolean(interrupted),
    };
    for (const listener of this.messageListeners) {
      listener(message);
    }
    return message;
  }

  /** All messages in sequence order, optionally only those after `afterSeq`. */
  listMessages(options: { afterSeq?: number } = {}): RoomMessage[] {
    const rows = (
      options.afterSeq === undefined
        ? this.db.prepare("SELECT * FROM messages ORDER BY seq").all()
        : this.db
            .prepare("SELECT * FROM messages WHERE seq > ? ORDER BY seq")
            .all(options.afterSeq)
    ) as MessageRow[];
    return rows.map(toMessage);
  }

  /**
   * Messages the agent has not been delivered yet — everything after its
   * last-delivered watermark (or after an explicit `sinceSeq`).
   */
  getMissedMessages(agentId: string, sinceSeq?: number): RoomMessage[] {
    const since = sinceSeq ?? this.getLastDeliveredSeq(agentId);
    return this.listMessages({ afterSeq: since });
  }

  // ------------------------------------------------------------------
  // Per-agent delivery watermark (derived per-agent view, KTD4)
  // ------------------------------------------------------------------

  getLastDeliveredSeq(agentId: string): number {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(LAST_DELIVERED_PREFIX + agentId) as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  setLastDeliveredSeq(agentId: string, seq: number): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(LAST_DELIVERED_PREFIX + agentId, String(seq));
  }

  // ------------------------------------------------------------------
  // Agents
  // ------------------------------------------------------------------

  addAgent(agent: RoomAgentRecord): void {
    this.db
      .prepare("INSERT INTO agents (id, name, persona, config) VALUES (?, ?, ?, ?)")
      .run(agent.id, agent.name, agent.persona, JSON.stringify(agent.config));
  }

  getAgent(id: string): RoomAgentRecord | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | AgentRow
      | undefined;
    return row ? toAgent(row) : null;
  }

  listAgents(): RoomAgentRecord[] {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY rowid").all() as AgentRow[];
    return rows.map(toAgent);
  }

  countAgents(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number };
    return row.n;
  }

  // ------------------------------------------------------------------
  // Events (raw turn events; the activity rail projects from these)
  // ------------------------------------------------------------------

  appendEvent(input: AppendEventInput): RoomEventRecord {
    const seq = this.nextSeq("events");
    const createdAt = input.createdAt ?? Date.now();
    const payload = JSON.stringify(input.payload ?? null);
    const info = this.db
      .prepare(
        `INSERT INTO events (seq, agent_id, kind, payload, turn_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(seq, input.agentId, input.kind, payload, input.turnId ?? null, createdAt);
    const record: RoomEventRecord = {
      id: Number(info.lastInsertRowid),
      seq,
      agentId: input.agentId,
      kind: input.kind,
      payload: input.payload ?? null,
      turnId: input.turnId ?? null,
      createdAt,
    };
    for (const listener of this.eventListeners) {
      listener(record);
    }
    return record;
  }

  listEvents(options: { agentId?: string; afterSeq?: number } = {}): RoomEventRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.agentId !== undefined) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }
    if (options.afterSeq !== undefined) {
      clauses.push("seq > ?");
      params.push(options.afterSeq);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY seq`)
      .all(...params) as EventRow[];
    return rows.map(toEvent);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private nextSeq(table: "messages" | "events"): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ${table}`)
      .get() as { seq: number };
    return row.seq;
  }
}
