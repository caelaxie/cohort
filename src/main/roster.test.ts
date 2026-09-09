import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { HATCH, parseBotId, parseRoster } from '../shared/roster'
import { stateDbPath } from './paths'
import { RosterStore } from './roster'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-roster-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

function sqliteCurrent(home: string): string | null {
  const db = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'current_id'").get() as
      { value: string | null } | undefined
    return row?.value ?? null
  } finally {
    db.close()
  }
}

function sqliteDataVersion(home: string): number {
  const db = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
  try {
    return db.pragma('data_version', { simple: true }) as number
  } finally {
    db.close()
  }
}

function seedCurrent(home: string, value: string): void {
  const db = new Database(stateDbPath(home))
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS teammates (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    db.prepare("INSERT INTO meta (key, value) VALUES ('current_id', ?)").run(value)
  } finally {
    db.close()
  }
}

describe('RosterStore.load', () => {
  it('returns Hatch as the only member and current on an empty home', () => {
    const store = new RosterStore(tempHome())
    const roster = store.load()
    expect(roster.hatch.id).toBe('hatch')
    expect(roster.hatch.name).toBe('Hatch')
    expect(roster.others).toEqual([])
    expect(roster.current).toBe('hatch')
    store.close()
  })

  it('repairs a dangling current_id to hatch', () => {
    const home = tempHome()
    seedCurrent(home, '33333333-3333-4333-8333-333333333333')
    const store = new RosterStore(home)
    const roster = store.load()
    expect(roster.current).toBe('hatch')
    expect(roster.hatch.id).toBe('hatch')
    expect(roster.hatch.name).toBe('Hatch')
    expect(roster.others).toEqual([])
    expect(sqliteCurrent(home)).toBe('hatch')
    store.close()
  })
})

describe('RosterStore.setCurrent', () => {
  it('does not write sqlite when current is already hatch', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    const loaded = store.load()
    expect(loaded.current).toBe('hatch')
    expect(sqliteCurrent(home)).toBe('hatch')
    const version = sqliteDataVersion(home)
    const next = store.setCurrent(parseBotId('hatch'))
    expect(next.current).toBe('hatch')
    expect(sqliteCurrent(home)).toBe('hatch')
    expect(sqliteDataVersion(home)).toBe(version)
    store.close()
  })
})

describe('parseRoster', () => {
  it('throws on leftover workspaces', () => {
    expect(() => parseRoster({ workspaces: [] })).toThrow()
  })

  it('accepts Hatch as the only member', () => {
    expect(parseRoster({ hatch: HATCH, others: [], current: 'hatch' })).toEqual({
      hatch: { id: 'hatch', name: 'Hatch' },
      others: [],
      current: 'hatch'
    })
  })
})
