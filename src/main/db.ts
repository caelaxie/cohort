import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { stateDbPath } from './paths'
import { schema } from './schema'

export type RosterDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

type SqliteColumn = { name: string }

function teammatesColumns(client: Database.Database): Set<string> {
  const rows = client.prepare('PRAGMA table_info(teammates)').all() as SqliteColumn[]
  return new Set(rows.map((row) => row.name))
}

function ensureTeammates(client: Database.Database): void {
  client.exec(`
    CREATE TABLE IF NOT EXISTS teammates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `)
  const cols = teammatesColumns(client)
  if (cols.has('id')) return
  const rebuild = client.transaction(() => {
    if (cols.has('uuid')) {
      client.exec(`
        CREATE TABLE teammates_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
        INSERT INTO teammates_new (id, name)
          SELECT uuid, name FROM teammates WHERE uuid != 'hatch';
        DROP TABLE teammates;
        ALTER TABLE teammates_new RENAME TO teammates;
      `)
      return
    }
    client.exec(`
      DROP TABLE teammates;
      CREATE TABLE teammates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
  })
  rebuild()
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
  `)
  ensureTeammates(client)
  return drizzle({ client, schema })
}
