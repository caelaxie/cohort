import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { CHIEF_ID, LEGACY_LEAD_ID } from '../shared/roster'
import { BODY_MAX, parseSendResult, parseThread } from '../shared/talk'
import type { Turn } from './turn'
import { openTalkDb } from './db'
import { stateDbPath, talkDbPath } from './paths'
import { turns } from './schema'
import { TalkStore } from './talk'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-talk-'))
  homes.push(home)
  return home
}

function ids(): () => string {
  let n = 0
  return () => `m${++n}`
}

function chiefKnown(id: string): boolean {
  return id === CHIEF_ID
}

function reply(body: string): Turn {
  return async () => ({ kind: 'ok', body })
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('TalkStore', () => {
  it('starts with an empty Chief thread', () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(talk.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    talk.close()
  })

  it('send persists a closed turn and reopen returns it', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('hi from Chief'),
      id: ids(),
      now: () => 1
    })
    expect(await talk.send({ botId: 'chief', body: 'hello' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'chief',
        turns: [
          {
            owner: { id: 'm1', body: 'hello', createdAt: 1 },
            bot: { id: 'm2', body: 'hi from Chief', createdAt: 1 }
          }
        ]
      }
    })
    talk.close()
    const reopened = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(reopened.thread('chief')).toEqual({
      botId: 'chief',
      turns: [
        {
          owner: { id: 'm1', body: 'hello', createdAt: 1 },
          bot: { id: 'm2', body: 'hi from Chief', createdAt: 1 }
        }
      ]
    })
    reopened.close()
  })

  it('reopen keeps owner then Chief when ids sort the other way', async () => {
    const home = tempHome()
    const seq = ['z-owner', 'a-bot']
    let i = 0
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('hi from Chief'),
      id: () => seq[i++],
      now: () => 1
    })
    await talk.send({ botId: 'chief', body: 'hello' })
    talk.close()
    const reopened = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(reopened.thread('chief').turns[0]).toEqual({
      owner: { id: 'z-owner', body: 'hello', createdAt: 1 },
      bot: { id: 'a-bot', body: 'hi from Chief', createdAt: 1 }
    })
    reopened.close()
  })

  it('second send appends after the first turn', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: async ({ ownerBody }) => ({ kind: 'ok', body: `re:${ownerBody}` }),
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'chief', body: 'one' })
    expect(await talk.send({ botId: 'chief', body: 'two' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'chief',
        turns: [
          {
            owner: { id: 'm1', body: 'one', createdAt: 1 },
            bot: { id: 'm2', body: 're:one', createdAt: 1 }
          },
          {
            owner: { id: 'm3', body: 'two', createdAt: 1 },
            bot: { id: 'm4', body: 're:two', createdAt: 1 }
          }
        ]
      }
    })
    talk.close()
  })

  it('overlapping send returns busy and does not call turn twice', async () => {
    let calls = 0
    let release: () => void = () => undefined
    let started: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: async () => {
        calls += 1
        started()
        await held
        return { kind: 'ok', body: 'done' }
      },
      id: ids(),
      now: () => 1
    })
    const first = talk.send({ botId: 'chief', body: 'hello' })
    await began
    expect(await talk.send({ botId: 'chief', body: 'again' })).toEqual({ kind: 'busy' })
    release()
    expect(await first).toEqual({
      kind: 'ok',
      thread: {
        botId: 'chief',
        turns: [
          {
            owner: { id: 'm1', body: 'hello', createdAt: 1 },
            bot: { id: 'm2', body: 'done', createdAt: 1 }
          }
        ]
      }
    })
    expect(calls).toBe(1)
    talk.close()
  })

  it('empty body writes nothing', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('nope')
    })
    expect(await talk.send({ botId: 'chief', body: '   ' })).toEqual({ kind: 'empty' })
    expect(talk.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    talk.close()
    expect(existsSync(talkDbPath(home))).toBe(true)
  })

  it('too-long body writes nothing', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: reply('nope')
    })
    expect(await talk.send({ botId: 'chief', body: 'x'.repeat(BODY_MAX + 1) })).toEqual({
      kind: 'too_long'
    })
    expect(talk.thread('chief').turns).toEqual([])
    talk.close()
  })

  it('needs_login writes nothing', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: async () => ({ kind: 'needs_login' })
    })
    expect(await talk.send({ botId: 'chief', body: 'hello' })).toEqual({ kind: 'needs_login' })
    expect(talk.thread('chief').turns).toEqual([])
    talk.close()
  })

  it('turn_failed writes nothing and later send works', async () => {
    let fail = true
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: async () => {
        if (fail) return { kind: 'turn_failed', detail: 'timeout' }
        return { kind: 'ok', body: 'ok' }
      },
      id: ids(),
      now: () => 1
    })
    expect(await talk.send({ botId: 'chief', body: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
    expect(talk.thread('chief').turns).toEqual([])
    fail = false
    expect(await talk.send({ botId: 'chief', body: 'hello' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'chief',
        turns: [
          {
            owner: { id: 'm1', body: 'hello', createdAt: 1 },
            bot: { id: 'm2', body: 'ok', createdAt: 1 }
          }
        ]
      }
    })
    talk.close()
  })

  it('unknown bot send returns unknown_bot and thread throws', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: reply('nope')
    })
    expect(await talk.send({ botId: 'ghost', body: 'hello' })).toEqual({ kind: 'unknown_bot' })
    expect(() => talk.thread('ghost')).toThrow('unknown bot')
    talk.close()
  })

  it('stores one drizzle row per closed turn', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('hi from Chief'),
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'chief', body: 'hello' })
    await talk.send({ botId: 'chief', body: 'again' })
    talk.close()
    const db = openTalkDb(home)
    try {
      expect(db.select().from(turns).all()).toEqual([
        {
          ownerId: 'm1',
          botId: 'chief',
          ownerBody: 'hello',
          botLineId: 'm2',
          botBody: 'hi from Chief',
          createdAt: 1
        },
        {
          ownerId: 'm3',
          botId: 'chief',
          ownerBody: 'again',
          botLineId: 'm4',
          botBody: 'hi from Chief',
          createdAt: 1
        }
      ])
    } finally {
      db.$client.close()
    }
  })

  it('renames leftover hatch bot_id rows to chief', () => {
    const home = tempHome()
    const path = talkDbPath(home)
    const seed = new Database(path)
    seed.exec(`
      CREATE TABLE turns (
        owner_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        owner_body TEXT NOT NULL,
        bot_line_id TEXT NOT NULL,
        bot_body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    seed
      .prepare(
        `INSERT INTO turns (owner_id, bot_id, owner_body, bot_line_id, bot_body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('m1', LEGACY_LEAD_ID, 'hello', 'm2', 'hi from Chief', 1)
    seed.close()
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(talk.thread('chief')).toEqual({
      botId: 'chief',
      turns: [
        {
          owner: { id: 'm1', body: 'hello', createdAt: 1 },
          bot: { id: 'm2', body: 'hi from Chief', createdAt: 1 }
        }
      ]
    })
    talk.close()
  })

  it('does not rewrite a hatch teammate row after lead-id migration', () => {
    const home = tempHome()
    const path = talkDbPath(home)
    const seed = new Database(path)
    seed.exec(`
      CREATE TABLE turns (
        owner_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        owner_body TEXT NOT NULL,
        bot_line_id TEXT NOT NULL,
        bot_body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    seed
      .prepare(
        `INSERT INTO turns (owner_id, bot_id, owner_body, bot_line_id, bot_body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('m1', LEGACY_LEAD_ID, 'hello', 'm2', 'hi from Chief', 1)
    seed.close()
    const first = openTalkDb(home)
    first.$client.close()
    const after = new Database(path)
    after
      .prepare(
        `INSERT INTO turns (owner_id, bot_id, owner_body, bot_line_id, bot_body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('m3', LEGACY_LEAD_ID, 'from hatch', 'm4', 'hi from Hatch', 2)
    after.close()
    const second = openTalkDb(home)
    try {
      expect(second.select().from(turns).all()).toEqual([
        {
          ownerId: 'm1',
          botId: CHIEF_ID,
          ownerBody: 'hello',
          botLineId: 'm2',
          botBody: 'hi from Chief',
          createdAt: 1
        },
        {
          ownerId: 'm3',
          botId: LEGACY_LEAD_ID,
          ownerBody: 'from hatch',
          botLineId: 'm4',
          botBody: 'hi from Hatch',
          createdAt: 2
        }
      ])
    } finally {
      second.$client.close()
    }
  })

  it('does not create a teammates table', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('hi'),
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'chief', body: 'hello' })
    talk.close()
    expect(existsSync(stateDbPath(home))).toBe(false)
    const db = new Database(talkDbPath(home), { readonly: true, fileMustExist: true })
    try {
      const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as { name: string }[]
      expect(names).toEqual([{ name: 'turns' }])
    } finally {
      db.close()
    }
  })
})

describe('parseThread', () => {
  it('rejects a payload that smuggles apiKey', () => {
    expect(() =>
      parseThread({
        botId: 'chief',
        turns: [],
        apiKey: 'sk'
      })
    ).toThrow('secret field')
  })
})

describe('parseSendResult', () => {
  it('rejects a result that smuggles key', () => {
    expect(() =>
      parseSendResult({ kind: 'ok', thread: { botId: 'chief', turns: [] }, key: 'sk' })
    ).toThrow('secret field')
  })
})
