import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
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
import { openTalkDb, type TalkDb } from './db'
import { turns } from './schema'

export type TalkOptions = {
  readonly home: string
  readonly turn: Turn
  readonly known: (id: BotId) => boolean
  readonly now?: () => number
  readonly id?: () => string
}

function toClosedTurn(row: typeof turns.$inferSelect): ClosedTurn {
  return {
    owner: {
      id: parseMessageId(row.ownerId),
      body: row.ownerBody,
      createdAt: row.createdAt
    },
    bot: {
      id: parseMessageId(row.botLineId),
      body: row.botBody,
      createdAt: row.createdAt
    }
  }
}

export class TalkStore {
  private readonly db: TalkDb
  private readonly turn: Turn
  private readonly known: (id: BotId) => boolean
  private readonly now: () => number
  private readonly id: () => string
  private readonly inFlight = new Set<string>()

  constructor(options: TalkOptions) {
    this.db = openTalkDb(options.home)
    this.turn = options.turn
    this.known = options.known
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
  }

  close(): void {
    this.db.$client.close()
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
      const result = await this.turn({ prior, ownerBody: parsed.body })
      if (result.kind !== 'ok') {
        return result
      }
      const createdAt = this.now()
      const owner: Line = {
        id: parseMessageId(this.id()),
        body: parsed.body,
        createdAt
      }
      const bot: Line = {
        id: parseMessageId(this.id()),
        body: result.body,
        createdAt
      }
      const closed: ClosedTurn = { owner, bot }
      this.insertTurn(request.botId, closed)
      return {
        kind: 'ok',
        thread: { botId: request.botId, turns: [...prior.turns, closed] }
      }
    } finally {
      this.inFlight.delete(request.botId)
    }
  }

  private readTurns(botId: BotId): ClosedTurn[] {
    return this.db
      .select()
      .from(turns)
      .where(eq(turns.botId, botId))
      .orderBy(asc(turns.createdAt), asc(turns.ownerId))
      .all()
      .map(toClosedTurn)
  }

  private insertTurn(botId: BotId, turn: ClosedTurn): void {
    this.db
      .insert(turns)
      .values({
        ownerId: turn.owner.id,
        botId,
        ownerBody: turn.owner.body,
        botLineId: turn.bot.id,
        botBody: turn.bot.body,
        createdAt: turn.owner.createdAt
      })
      .run()
  }
}
