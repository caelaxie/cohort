import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { stateDbPath } from './paths'
import { schema } from './schema'

export type RosterDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

export function openRosterDb(home: string): RosterDb {
  mkdirSync(home, { recursive: true })
  const client = new Database(stateDbPath(home))
  client.pragma('foreign_keys = ON')
  const db = drizzle({ client, schema })
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
  return db
}
