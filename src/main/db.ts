import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { CHIEF_ID, LEGACY_LEAD_ID } from '../shared/roster'
import { stateDbPath, talkDbPath } from './paths'
import { schema, talkSchema } from './schema'

export type RosterDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database }
export type TalkDb = BetterSQLite3Database<typeof talkSchema> & { $client: Database.Database }

const LEGACY_LEAD_MIGRATION_VERSION = 1

export function migrateLegacyLeadBotId(client: Database.Database): void {
  const version = Number(client.pragma('user_version', { simple: true }))
  if (version >= LEGACY_LEAD_MIGRATION_VERSION) return
  client.prepare('UPDATE turns SET bot_id = ? WHERE bot_id = ?').run(CHIEF_ID, LEGACY_LEAD_ID)
  client.pragma(`user_version = ${LEGACY_LEAD_MIGRATION_VERSION}`)
}

export function openRosterDb(home: string): RosterDb {
  mkdirSync(home, { recursive: true })
  const client = new Database(stateDbPath(home))
  client.pragma('foreign_keys = ON')
  client.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS teammates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `)
  return drizzle({ client, schema })
}

export function openTalkDb(home: string): TalkDb {
  mkdirSync(home, { recursive: true })
  const client = new Database(talkDbPath(home))
  client.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      owner_id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      owner_body TEXT NOT NULL,
      bot_line_id TEXT NOT NULL,
      bot_body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS turns_bot_created ON turns (bot_id, created_at, owner_id);
  `)
  migrateLegacyLeadBotId(client)
  return drizzle({ client, schema: talkSchema })
}
