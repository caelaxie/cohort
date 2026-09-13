import { randomUUID } from 'node:crypto'
import { asc, desc, eq } from 'drizzle-orm'
import { CHIEF_ID, parseBotId, type BotId } from '../shared/roster'
import {
  parseBody,
  parseMessageId,
  parseSendRequest,
  roomTurnBody,
  type ClosedTurn,
  type Coordination,
  type InterruptResult,
  type Line,
  type Room,
  type RoomLine,
  type RoomSendResult,
  type SendResult,
  type Thread
} from '../shared/talk'
import { openTalkDb, type TalkDb } from './db'
import { roomLines, turns } from './schema'
import type { Turn } from './turn'

export type TalkOptions = {
  readonly home: string
  readonly turn: Turn
  readonly roomTurn?: Turn
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
  private readonly roomTurn: Turn
  private readonly known: (id: BotId) => boolean
  private readonly now: () => number
  private readonly id: () => string
  private readonly inflight = new Map<
    string,
    { readonly brief: string; readonly abort: AbortController }
  >()
  private roomFlight: BotId | null = null

  constructor(options: TalkOptions) {
    this.db = openTalkDb(options.home)
    this.turn = options.turn
    this.roomTurn = options.roomTurn ?? options.turn
    this.known = options.known
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
  }

  close(): void {
    for (const { abort } of this.inflight.values()) {
      abort.abort()
    }
    this.db.$client.close()
  }

  thread(id: unknown): Thread {
    const botId = parseBotId(id)
    if (!this.known(botId)) {
      throw new Error('unknown bot')
    }
    return { botId, turns: this.readTurns(botId) }
  }

  room(): Room {
    return { lines: this.readRoomLines() }
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
    if (this.inflight.has(request.botId)) {
      return { kind: 'busy' }
    }
    const abort = new AbortController()
    this.inflight.set(request.botId, { brief: parsed.body, abort })
    try {
      const prior: Thread = { botId: request.botId, turns: this.readTurns(request.botId) }
      const result = await this.turn({ prior, ownerBody: parsed.body, signal: abort.signal })
      if (result.kind !== 'ok') {
        return result
      }
      if (abort.signal.aborted) {
        return { kind: 'stopped' }
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
      this.inflight.delete(request.botId)
    }
  }

  async roomSend(input: unknown): Promise<RoomSendResult> {
    const request = parseSendRequest(input)
    const parsed = parseBody(request.body)
    if (parsed.kind !== 'ok') {
      return parsed
    }
    if (!this.known(request.botId)) {
      return { kind: 'unknown_bot' }
    }
    if (this.roomFlight !== null || this.inflight.has(request.botId)) {
      return { kind: 'busy' }
    }
    const abort = new AbortController()
    this.roomFlight = request.botId
    this.inflight.set(request.botId, { brief: parsed.body, abort })
    try {
      const prior = this.readRoomLines()
      const result = await this.roomTurn({
        prior: { botId: request.botId, turns: [] },
        ownerBody: roomTurnBody(prior, parsed.body),
        signal: abort.signal
      })
      if (result.kind !== 'ok') {
        return result
      }
      if (abort.signal.aborted) {
        return { kind: 'stopped' }
      }
      const createdAt = this.now()
      const owner: RoomLine = {
        id: parseMessageId(this.id()),
        speaker: { kind: 'owner' },
        body: parsed.body,
        createdAt
      }
      const bot: RoomLine = {
        id: parseMessageId(this.id()),
        speaker: { kind: 'bot', botId: request.botId },
        body: result.body,
        createdAt
      }
      this.insertRoomLines([owner, bot])
      return { kind: 'ok', room: { lines: [...prior, owner, bot] } }
    } finally {
      this.inflight.delete(request.botId)
      this.roomFlight = null
    }
  }

  assign(input: unknown): Promise<SendResult> {
    const request = parseSendRequest(input)
    if (request.botId === CHIEF_ID) {
      return Promise.resolve({ kind: 'not_teammate' })
    }
    return this.send(input)
  }

  interrupt(id: unknown): InterruptResult {
    const botId = parseBotId(id)
    if (!this.known(botId)) {
      return { kind: 'unknown_bot' }
    }
    const running = this.inflight.get(botId)
    if (!running) {
      return { kind: 'idle' }
    }
    running.abort.abort()
    return { kind: 'ok' }
  }

  coordination(): Coordination {
    return {
      running: [...this.inflight.entries()].map(([botId, { brief }]) => ({
        botId: parseBotId(botId),
        brief
      }))
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

  private readRoomLines(): RoomLine[] {
    return this.db.select().from(roomLines).orderBy(asc(roomLines.n)).all().map(toRoomLine)
  }

  private insertRoomLines(lines: readonly RoomLine[]): void {
    let n = this.nextRoomN()
    this.db.transaction((tx) => {
      for (const line of lines) {
        tx.insert(roomLines)
          .values({
            n,
            id: line.id,
            speakerKind: line.speaker.kind,
            speakerBotId: line.speaker.kind === 'bot' ? line.speaker.botId : null,
            body: line.body,
            createdAt: line.createdAt
          })
          .run()
        n += 1
      }
    })
  }

  private nextRoomN(): number {
    const last = this.db
      .select({ n: roomLines.n })
      .from(roomLines)
      .orderBy(desc(roomLines.n))
      .limit(1)
      .get()
    return (last?.n ?? 0) + 1
  }
}

function toRoomLine(row: typeof roomLines.$inferSelect): RoomLine {
  if (row.speakerKind === 'owner') {
    return {
      id: parseMessageId(row.id),
      speaker: { kind: 'owner' },
      body: row.body,
      createdAt: row.createdAt
    }
  }
  if (row.speakerKind !== 'bot' || row.speakerBotId === null) {
    throw new Error('invalid room line')
  }
  return {
    id: parseMessageId(row.id),
    speaker: { kind: 'bot', botId: parseBotId(row.speakerBotId) },
    body: row.body,
    createdAt: row.createdAt
  }
}
