import { asc, eq, sql } from 'drizzle-orm'
import {
  HATCH,
  HATCH_ID,
  parseBotId,
  parseRoster,
  type BotId,
  type Roster,
  type Teammate
} from '../shared/roster'
import { openRosterDb, type RosterDb } from './db'
import { meta, teammates } from './schema'

const CURRENT_KEY = 'current_id'

export class RosterStore {
  private readonly db: RosterDb

  constructor(home: string) {
    this.db = openRosterDb(home)
  }

  close(): void {
    this.db.$client.close()
  }

  load(): Roster {
    const others = this.listTeammates()
    const current = this.resolvedCurrent(others)
    return parseRoster({ hatch: HATCH, others, current })
  }

  setCurrent(id: BotId): Roster {
    const botId = parseBotId(id)
    const others = this.listTeammates()
    if (!this.isKnown(botId, others)) {
      throw new Error('unknown bot')
    }
    if (this.readCurrentId() !== botId) {
      this.writeCurrent(botId)
    }
    return parseRoster({ hatch: HATCH, others, current: botId })
  }

  private listTeammates(): Teammate[] {
    const rows = this.db
      .select({ uuid: teammates.uuid, name: teammates.name })
      .from(teammates)
      .orderBy(asc(teammates.createdAt), asc(teammates.uuid))
      .all()
    return rows.map((row) => {
      const id = parseBotId(row.uuid)
      if (id === HATCH_ID) {
        throw new Error('Hatch cannot be a teammate')
      }
      return { id, name: row.name }
    })
  }

  private resolvedCurrent(others: readonly Teammate[]): BotId {
    const stored = this.readCurrentId()
    if (stored !== null) {
      try {
        const parsed = parseBotId(stored)
        if (this.isKnown(parsed, others)) return parsed
      } catch {
        // invalid stored id
      }
    }
    this.writeCurrent(HATCH_ID)
    return HATCH_ID
  }

  private isKnown(id: BotId, others: readonly Teammate[]): boolean {
    if (id === HATCH_ID) return true
    return others.some((teammate) => teammate.id === id)
  }

  private readCurrentId(): string | null {
    const row = this.db
      .select({ value: meta.value })
      .from(meta)
      .where(eq(meta.key, CURRENT_KEY))
      .get()
    return row?.value ?? null
  }

  private writeCurrent(id: BotId): void {
    this.db
      .insert(meta)
      .values({ key: CURRENT_KEY, value: id })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } })
      .run()
  }
}
