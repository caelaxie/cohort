import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_LEAD_ID,
  NAME_MAX,
  parseBotId,
  parseBotName,
  parseRoster,
  teammateIdFromName
} from '../shared/roster'
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

function chiefRoster() {
  return {
    chief: { id: 'chief', name: 'Chief' },
    others: [],
    current: 'chief'
  }
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('RosterStore', () => {
  it('loads Chief only', () => {
    const store = new RosterStore(tempHome())
    expect(store.load()).toEqual(chiefRoster())
    expect(store.known('chief')).toBe(true)
    expect(store.known(parseBotId('ghost'))).toBe(false)
    store.close()
  })

  it('second load and reopen converge to the same roster', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    const first = store.load()
    expect(store.load()).toEqual(first)
    store.close()
    const reopened = new RosterStore(home)
    expect(reopened.load()).toEqual(first)
    reopened.close()
  })

  it('repairs a dangling current_id to chief and writes it', () => {
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
    expect(repaired.load()).toEqual(chiefRoster())
    repaired.close()

    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      expect(check.prepare(`SELECT value FROM meta WHERE key = 'current_id'`).get()).toEqual({
        value: 'chief'
      })
    } finally {
      check.close()
    }
  })

  it('repairs leftover hatch current_id to chief', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    store.load()
    store.close()
    const db = new Database(stateDbPath(home))
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('current_id', ?)`).run(
      LEGACY_LEAD_ID
    )
    db.close()
    const repaired = new RosterStore(home)
    expect(repaired.load()).toEqual(chiefRoster())
    repaired.close()
    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      expect(check.prepare(`SELECT value FROM meta WHERE key = 'current_id'`).get()).toEqual({
        value: 'chief'
      })
    } finally {
      check.close()
    }
  })

  it('select chief when already current does not bump sqlite data_version', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    expect(store.load()).toEqual(chiefRoster())
    const before = dataVersion(home)
    expect(store.select('chief')).toEqual(chiefRoster())
    expect(dataVersion(home)).toBe(before)
    store.close()
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
    expect(store.load()).toEqual(chiefRoster())
    store.close()

    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      const rows = check.prepare(`SELECT key, value FROM meta ORDER BY key`).all() as {
        key: string
        value: string
      }[]
      expect(rows).toEqual([
        { key: 'current_id', value: 'chief' },
        { key: 'current_uuid', value: '11111111-1111-4111-8111-111111111111' }
      ])
    } finally {
      check.close()
    }
  })

  it('hatches a named teammate, selects it, and removes it', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    expect(store.hatch('Scout')).toEqual({
      chief: { id: 'chief', name: 'Chief' },
      others: [{ id: 'scout', name: 'Scout' }],
      current: 'scout'
    })
    expect(store.known(parseBotId('scout'))).toBe(true)
    expect(store.bot(parseBotId('scout'))).toEqual({ id: 'scout', name: 'Scout' })
    expect(store.select('scout')).toEqual({
      chief: { id: 'chief', name: 'Chief' },
      others: [{ id: 'scout', name: 'Scout' }],
      current: 'scout'
    })
    expect(store.remove('scout')).toEqual(chiefRoster())
    expect(store.known(parseBotId('scout'))).toBe(false)
    store.close()

    const reopened = new RosterStore(home)
    expect(reopened.load()).toEqual(chiefRoster())
    reopened.close()
  })

  it('hatches Hatch as a teammate id after the lead rename', () => {
    const store = new RosterStore(tempHome())
    expect(store.hatch('Hatch')).toEqual({
      chief: { id: 'chief', name: 'Chief' },
      others: [{ id: LEGACY_LEAD_ID, name: 'Hatch' }],
      current: LEGACY_LEAD_ID
    })
    store.close()
  })

  it('rejects a second hatch of the same name and leaves the first', () => {
    const store = new RosterStore(tempHome())
    store.hatch('Scout')
    expect(() => store.hatch('scout')).toThrow('That bot already exists')
    expect(store.load().others).toEqual([{ id: 'scout', name: 'Scout' }])
    store.close()
  })

  it('rejects hatching Chief and does not write a teammates row', () => {
    const home = tempHome()
    const store = new RosterStore(home)
    expect(() => store.hatch('Chief')).toThrow('Chief is already the lead')
    expect(store.load()).toEqual(chiefRoster())
    store.close()
    const check = new Database(stateDbPath(home), { readonly: true, fileMustExist: true })
    try {
      expect(check.prepare(`SELECT id, name FROM teammates`).all()).toEqual([])
    } finally {
      check.close()
    }
  })

  it('cannot remove Chief', () => {
    const store = new RosterStore(tempHome())
    expect(() => store.remove('chief')).toThrow('cannot remove chief')
    expect(store.load()).toEqual(chiefRoster())
    store.close()
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

describe('parseRoster', () => {
  it('throws without chief', () => {
    expect(() => parseRoster({ others: [], current: 'chief' })).toThrow('missing chief')
  })

  it('throws on chief in others', () => {
    const chief = { id: 'chief', name: 'Chief' }
    expect(() => parseRoster({ chief, others: [chief], current: 'chief' })).toThrow(
      'chief in others'
    )
  })
})

describe('parseBotName', () => {
  it('trims and rejects empty, too-long, and unslugable names', () => {
    expect(parseBotName('  Scout  ')).toBe('Scout')
    expect(() => parseBotName('   ')).toThrow('Name a bot')
    expect(() => parseBotName('x'.repeat(NAME_MAX + 1))).toThrow('Name is too long')
    expect(teammateIdFromName('Ada Lovelace')).toBe('ada-lovelace')
    expect(() => teammateIdFromName('!!!')).toThrow('Name a bot')
    expect(() => teammateIdFromName('Chief')).toThrow('Chief is already the lead')
  })
})
