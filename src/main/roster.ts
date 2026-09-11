import { asc, eq, sql } from 'drizzle-orm'
import {
  CHIEF,
  CHIEF_ID,
  parseBotId,
  parseTeammate,
  type BotId,
  type Roster,
  type Teammate
} from '../shared/roster'
import { openRosterDb, type RosterDb } from './db'
import { meta, teammates } from './schema'

const CURRENT_ID_KEY = 'current_id'

export class RosterStore {
  private readonly db: RosterDb

  constructor(home: string) {
    this.db = openRosterDb(home)
  }

  close(): void {
    this.db.$client.close()
  }

  load(): Roster {
    const others = this.readOthers()
    const stored = this.readCurrentId()
    const current =
      stored !== null && this.knownIds(others).has(stored) ? parseBotId(stored) : CHIEF_ID
    if (stored !== current) {
      this.writeCurrent(current)
    }
    return { chief: CHIEF, others, current }
  }

  known(id: BotId): boolean {
    return this.knownIds(this.readOthers()).has(id)
  }

  select(id: unknown): Roster {
    const botId = parseBotId(id)
    const others = this.readOthers()
    if (!this.knownIds(others).has(botId)) {
      throw new Error('unknown bot')
    }
    const stored = this.readCurrentId()
    if (stored !== botId) {
      this.writeCurrent(botId)
    }
    return { chief: CHIEF, others, current: botId }
  }

  private knownIds(others: readonly Teammate[]): Set<string> {
    return new Set<string>([CHIEF_ID, ...others.map((item) => item.id)])
  }

  private readOthers(): Teammate[] {
    return this.db
      .select({ id: teammates.id, name: teammates.name })
      .from(teammates)
      .orderBy(asc(teammates.id))
      .all()
      .map(parseTeammate)
  }

  private readCurrentId(): string | null {
    const row = this.db
      .select({ value: meta.value })
      .from(meta)
      .where(eq(meta.key, CURRENT_ID_KEY))
      .get()
    return row?.value ?? null
  }

  private writeCurrent(id: BotId): void {
    this.db
      .insert(meta)
      .values({ key: CURRENT_ID_KEY, value: id })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } })
      .run()
  }
}
