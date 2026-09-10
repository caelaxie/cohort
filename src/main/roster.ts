import { asc, eq, sql } from 'drizzle-orm'
import {
  HATCH,
  HATCH_ID,
  homeFromRoster,
  parseBotId,
  rosterBots,
  type BotId,
  type Home,
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

  load(): Home {
    const others = this.readOthers()
    const known = new Set<string>([HATCH_ID, ...others.map((item) => item.id)])
    const stored = this.readCurrentId()
    const current = stored !== null && known.has(stored) ? parseBotId(stored) : HATCH_ID
    if (stored !== current) {
      this.writeCurrent(current)
    }
    return homeFromRoster({ hatch: HATCH, others, current })
  }

  select(id: string): Home {
    const botId = parseBotId(id)
    const home = this.load()
    if (home.roster.current === botId) {
      return home
    }
    if (!rosterBots(home.roster).some((bot) => bot.id === botId)) {
      throw new Error('unknown bot')
    }
    this.writeCurrent(botId)
    return this.load()
  }

  private readOthers(): Teammate[] {
    const rows = this.db
      .select({ id: teammates.id, name: teammates.name })
      .from(teammates)
      .orderBy(asc(teammates.id))
      .all()
    const others: Teammate[] = []
    for (const row of rows) {
      if (row.id === HATCH_ID) continue
      others.push({ id: parseBotId(row.id) as Teammate['id'], name: row.name })
    }
    return others
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
