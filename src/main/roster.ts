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
    const stored = this.readCurrentId()
    let current: BotId | null = null
    if (stored !== null) {
      try {
        const parsed = parseBotId(stored)
        if (this.isKnown(parsed, others)) current = parsed
      } catch {
        current = null
      }
    }
    if (current === null) {
      this.writeCurrent(HATCH_ID)
      current = HATCH_ID
    }
    return parseRoster({ hatch: HATCH, others, current })
  }

  setCurrent(id: BotId): Roster {
    const botId = parseBotId(id)
    const roster = this.load()
    if (roster.current === botId) return roster
    if (!this.isKnown(botId, roster.others)) {
      throw new Error('unknown bot')
    }
    this.writeCurrent(botId)
    return this.load()
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
