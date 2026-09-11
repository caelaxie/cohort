import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { parseBotId, type BotId } from '../shared/roster'
import {
  parseBody,
  parseMessageId,
  parseSendRequest,
  type ClosedTurn,
  type Line,
  type SendResult,
  type Thread
} from '../shared/talk'
import type { Turn } from './completions'
import { talkDbPath } from './paths'

type MessageRow = {
  id: string
  bot_id: string
  author: string
  body: string
  created_at: number
}

export type TalkOptions = {
  readonly home: string
  readonly turn: Turn
  readonly known: (id: BotId) => boolean
  readonly now?: () => number
  readonly id?: () => string
}

function toLine(row: MessageRow): Line {
  return {
    id: parseMessageId(row.id),
    body: row.body,
    createdAt: row.created_at
  }
}

function pairRows(botId: BotId, rows: MessageRow[]): ClosedTurn[] {
  if (rows.length % 2 !== 0) {
    throw new Error('thread unreadable')
  }
  const turns: ClosedTurn[] = []
  for (let i = 0; i < rows.length; i += 2) {
    const owner = rows[i]
    const bot = rows[i + 1]
    if (owner.author !== 'owner' || bot.author !== 'bot') {
      throw new Error('thread unreadable')
    }
    if (owner.bot_id !== botId || bot.bot_id !== botId) {
      throw new Error('thread unreadable')
    }
    turns.push({ owner: toLine(owner), bot: toLine(bot) })
  }
  return turns
}

export class TalkStore {
  private readonly db: Database.Database
  private readonly turn: Turn
  private readonly known: (id: BotId) => boolean
  private readonly now: () => number
  private readonly id: () => string
  private readonly inFlight = new Set<string>()

  constructor(options: TalkOptions) {
    mkdirSync(options.home, { recursive: true })
    this.db = new Database(talkDbPath(options.home))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_bot_created ON messages (bot_id, created_at, id);
    `)
    this.turn = options.turn
    this.known = options.known
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
  }

  close(): void {
    this.db.close()
  }

  thread(id: unknown): Thread {
    const botId = parseBotId(id)
    if (!this.known(botId)) {
      throw new Error('unknown bot')
    }
    return { botId, turns: this.readTurns(botId) }
  }

  async send(input: unknown): Promise<SendResult> {
    const request = parseSendRequest(input)
    const parsed = parseBody(request.body)
    if (parsed.kind !== 'ok') {
      return parsed
    }
    if (!this.known(request.botId)) {
      return { kind: 'unknown_bot' }
    }
    if (this.inFlight.has(request.botId)) {
      return { kind: 'busy' }
    }
    this.inFlight.add(request.botId)
    try {
      const prior: Thread = { botId: request.botId, turns: this.readTurns(request.botId) }
      let reply: string
      try {
        reply = await this.turn({ prior, ownerBody: parsed.body })
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : 'turn failed'
        if (message === 'needs_login') {
          return { kind: 'needs_login' }
        }
        return { kind: 'turn_failed', detail: message }
      }
      const trimmed = reply.trim()
      if (trimmed.length === 0) {
        return { kind: 'turn_failed', detail: 'empty reply' }
      }
      const createdAt = this.now()
      const owner: Line = {
        id: parseMessageId(this.id()),
        body: parsed.body,
        createdAt
      }
      const bot: Line = {
        id: parseMessageId(this.id()),
        body: trimmed,
        createdAt
      }
      this.insertPair(request.botId, owner, bot)
      return {
        kind: 'ok',
        thread: { botId: request.botId, turns: [...prior.turns, { owner, bot }] }
      }
    } finally {
      this.inFlight.delete(request.botId)
    }
  }

  private readTurns(botId: BotId): ClosedTurn[] {
    const rows = this.db
      .prepare(
        `SELECT id, bot_id, author, body, created_at FROM messages WHERE bot_id = ? ORDER BY rowid`
      )
      .all(botId) as MessageRow[]
    return pairRows(botId, rows)
  }

  private insertPair(botId: BotId, owner: Line, bot: Line): void {
    const insert = this.db.prepare(
      `INSERT INTO messages (id, bot_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    const write = this.db.transaction(() => {
      insert.run(owner.id, botId, 'owner', owner.body, owner.createdAt)
      insert.run(bot.id, botId, 'bot', bot.body, bot.createdAt)
    })
    write()
  }
}
