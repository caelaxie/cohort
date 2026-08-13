import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { stateDbPath } from './paths'

export function openRosterDb(home: string): Database.Database {
  mkdirSync(home, { recursive: true })
  const db = new Database(stateDbPath(home))
  db.pragma('foreign_keys = ON')
  db.exec(`
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
