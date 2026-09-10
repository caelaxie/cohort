import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { parseHome } from '../shared/roster'
import { stateDbPath } from './paths'
import { RosterStore } from './roster'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-roster-'))
  homes.push(home)
  return home
}

function dataVersion(home: string): number {
  const db = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
  try {
    return Number(db.pragma('data_version', { simple: true }))
  } finally {
    db.close()
  }
}

function hatchHome() {
  return {
    roster: {
      hatch: { id: 'hatch', name: 'Hatch' },
      others: [],
      current: 'hatch'
    },
    thread: {
      bot: { id: 'hatch', name: 'Hatch' },
      messages: []
    }
  }
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('RosterStore', () => {
  it('loads Hatch only with an empty thread', () => {
    const store = new RosterStore(tempHome())
    expect(store.load()).toEqual(hatchHome())
    store.close()
  })

  it('second load and reopen converge to the same home', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    const first = store.load()
    expect(store.load()).toEqual(first)
    store.close()
    const reopened = new RosterStore(home)
    expect(reopened.load()).toEqual(first)
    reopened.close()
  })

  it('repairs a dangling current_id to hatch and writes it', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    store.load()
    store.close()

    const db = new Database(stateDbPath(home))
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('current_id', ?)`).run(
      'missing-bot'
    )
    db.close()

    const repaired = new RosterStore(home)
    expect(repaired.load()).toEqual(hatchHome())
    repaired.close()

    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      expect(check.prepare(`SELECT value FROM meta WHERE key = 'current_id'`).get()).toEqual({
        value: 'hatch'
      })
    } finally {
      check.close()
    }
  })

  it('select hatch when already current does not bump sqlite data_version', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    expect(store.load()).toEqual(hatchHome())
    const before = dataVersion(home)
    expect(store.select('hatch')).toEqual(hatchHome())
    expect(dataVersion(home)).toBe(before)
    store.close()
  })

  it('migrates a uuid-shaped teammates table and loads Hatch', () => {
    const home = tempHome()
    const db = new Database(stateDbPath(home))
    db.exec(`
      CREATE TABLE workspaces (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE teammates (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    db.prepare(`INSERT INTO meta (key, value) VALUES ('current_uuid', ?)`).run(
      '2289d696-83ac-41d7-bafe-07270fdef875'
    )
    db.prepare(`INSERT INTO meta (key, value) VALUES ('current_id', ?)`).run('hatch')
    db.close()

    const store = new RosterStore(home)
    expect(store.load()).toEqual(hatchHome())
    store.close()

    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      const cols = check.prepare(`PRAGMA table_info(teammates)`).all() as { name: string }[]
      expect(cols.map((col) => col.name)).toEqual(['id', 'name'])
    } finally {
      check.close()
    }
  })

  it('ignores leftover current_uuid and writes current_id on load', () => {
    const home = tempHome()
    const db = new Database(stateDbPath(home))
    db.exec(`
      CREATE TABLE IF NOT EXISTS teammates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    db.prepare(`INSERT INTO meta (key, value) VALUES ('current_uuid', ?)`).run(
      '11111111-1111-4111-8111-111111111111'
    )
    db.close()

    const store = new RosterStore(home)
    expect(store.load()).toEqual(hatchHome())
    store.close()

    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      const rows = check.prepare(`SELECT key, value FROM meta ORDER BY key`).all() as {
        key: string
        value: string
      }[]
      expect(rows).toEqual([
        { key: 'current_id', value: 'hatch' },
        { key: 'current_uuid', value: '11111111-1111-4111-8111-111111111111' }
      ])
    } finally {
      check.close()
    }
  })

  it('unknown select throws and does not write current_id', () => {
    const home = tempHome()
    const db = new Database(stateDbPath(home))
    db.exec(`
      CREATE TABLE IF NOT EXISTS teammates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    db.prepare(`INSERT INTO meta (key, value) VALUES ('current_id', ?)`).run('ghost')
    db.close()

    const store = new RosterStore(home)
    expect(() => store.select('nope')).toThrow('unknown bot')
    store.close()

    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      expect(check.prepare(`SELECT value FROM meta WHERE key = 'current_id'`).get()).toEqual({
        value: 'ghost'
      })
    } finally {
      check.close()
    }
  })
})

describe('parseHome', () => {
  it('throws without hatch', () => {
    expect(() =>
      parseHome({
        roster: { others: [], current: 'hatch' },
        thread: { bot: { id: 'hatch', name: 'Hatch' }, messages: [] }
      })
    ).toThrow('missing hatch')
  })

  it('throws on leftover workspace fields', () => {
    expect(() =>
      parseHome({
        roster: { hatch: { id: 'hatch', name: 'Hatch' }, others: [], current: 'hatch' },
        thread: { bot: { id: 'hatch', name: 'Hatch' }, messages: [] },
        workspaces: []
      })
    ).toThrow('leftover workspace fields')
  })

  it('throws on hatch in others and on a non-empty thread', () => {
    const hatch = { id: 'hatch', name: 'Hatch' }
    expect(() =>
      parseHome({
        roster: { hatch, others: [hatch], current: 'hatch' },
        thread: { bot: hatch, messages: [] }
      })
    ).toThrow('hatch in others')
    expect(() =>
      parseHome({
        roster: { hatch, others: [], current: 'hatch' },
        thread: { bot: hatch, messages: [{ body: 'hi' }] }
      })
    ).toThrow('non-empty messages')
  })
})
