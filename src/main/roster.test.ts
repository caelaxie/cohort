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
})
