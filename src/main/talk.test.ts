import { existsSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { CHIEF_ID, LEGACY_LEAD_ID, parseBotId } from '../shared/roster'
import {
  BODY_MAX,
  parseCoordination,
  parseInterruptResult,
  parseSendResult,
  parseThread,
  sendCopy
} from '../shared/talk'
import { botSystemPrompt } from './chief-prompt'
import { RosterStore } from './roster'
import { openTalkDb } from './db'
import { stateDbPath, talkDbPath } from './paths'
import { turns } from './schema'
import { TalkStore } from './talk'
import { chiefKnown, ids, reply, talkHomes } from './talk-test-util'

const { tempHome, cleanup } = talkHomes()

afterEach(cleanup)

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

  it('talks to a hatched bot on its own thread with that bot identity', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    const hatched = roster.hatch('Scout')
    expect(hatched.others).toEqual([{ id: 'scout', name: 'Scout' }])
    expect(hatched.current).toBe('scout')
    expect(roster.select('scout').current).toBe('scout')

    let seen: string | null = null
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: async ({ prior }) => {
        const bot = roster.bot(prior.botId)
        if (!bot) {
          throw new Error('unknown bot')
        }
        seen = botSystemPrompt(bot)
        return { kind: 'ok', body: `hi from ${bot.name}` }
      },
      id: ids(),
      now: () => 1
    })
    const sent = await talk.send({ botId: 'scout', body: 'hello' })
    expect(sent).toEqual({
      kind: 'ok',
      thread: {
        botId: 'scout',
        turns: [
          {
            owner: { id: 'm1', body: 'hello', createdAt: 1 },
            bot: { id: 'm2', body: 'hi from Scout', createdAt: 1 }
          }
        ]
      }
    })
    expect(seen).toBe(
      'You are Scout, a named teammate in Cohort, a crew of named AI teammates on this Mac. Reply as a teammate. Do not claim to have tools or a computer.'
    )
    expect(sendCopy({ kind: 'busy' }, 'Scout')).toBe('Scout is still answering')
    expect(talk.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    expect(JSON.stringify(sent).includes('key')).toBe(false)
    expect(JSON.stringify(sent).includes('apiKey')).toBe(false)
    expect(() =>
      parseSendResult({ kind: 'ok', thread: { botId: 'scout', turns: [] }, key: 'sk' })
    ).toThrow('secret field')
    expect(roster.remove('scout')).toEqual({
      chief: { id: 'chief', name: 'Chief' },
      others: [],
      current: 'chief'
    })
    expect(roster.known(parseBotId('scout'))).toBe(false)
    expect(await talk.send({ botId: 'scout', body: 'hello' })).toEqual({ kind: 'unknown_bot' })
    talk.close()
    roster.close()
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
      expect(names).toEqual([{ name: 'room_lines' }, { name: 'turns' }])
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

describe('Chief coordination', () => {
  it('assigns and steers a hatched bot on that bot thread', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: async ({ prior, ownerBody }) => ({
        kind: 'ok',
        body: `${prior.botId}:${ownerBody}`
      }),
      id: ids(),
      now: () => 1
    })
    expect(await talk.assign({ botId: 'chief', body: 'plan the work' })).toEqual({
      kind: 'not_teammate'
    })
    expect(await talk.assign({ botId: 'ghost', body: 'plan the work' })).toEqual({
      kind: 'unknown_bot'
    })
    expect(talk.coordination()).toEqual({ running: [] })
    expect(await talk.assign({ botId: 'scout', body: 'draft the outline' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'scout',
        turns: [
          {
            owner: { id: 'm1', body: 'draft the outline', createdAt: 1 },
            bot: { id: 'm2', body: 'scout:draft the outline', createdAt: 1 }
          }
        ]
      }
    })
    expect(await talk.assign({ botId: 'scout', body: 'tighten the intro' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'scout',
        turns: [
          {
            owner: { id: 'm1', body: 'draft the outline', createdAt: 1 },
            bot: { id: 'm2', body: 'scout:draft the outline', createdAt: 1 }
          },
          {
            owner: { id: 'm3', body: 'tighten the intro', createdAt: 1 },
            bot: { id: 'm4', body: 'scout:tighten the intro', createdAt: 1 }
          }
        ]
      }
    })
    expect(talk.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    expect(talk.coordination()).toEqual({ running: [] })
    talk.close()
    roster.close()
  })

  it('shows running coordination and interrupt writes nothing', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    let release: () => void = () => undefined
    let started: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: async ({ signal }) => {
        started()
        await new Promise<void>((resolve) => {
          const done = (): void => resolve()
          signal?.addEventListener('abort', done, { once: true })
          void held.then(done)
        })
        if (signal?.aborted) return { kind: 'stopped' }
        return { kind: 'ok', body: 'done' }
      },
      id: ids(),
      now: () => 1
    })
    const assigned = talk.assign({ botId: 'scout', body: 'draft the outline' })
    await began
    expect(talk.coordination()).toEqual({
      running: [{ botId: 'scout', brief: 'draft the outline' }]
    })
    expect(await talk.assign({ botId: 'scout', body: 'again' })).toEqual({ kind: 'busy' })
    expect(talk.interrupt('ghost')).toEqual({ kind: 'unknown_bot' })
    expect(talk.interrupt('chief')).toEqual({ kind: 'idle' })
    expect(talk.interrupt('scout')).toEqual({ kind: 'ok' })
    expect(await assigned).toEqual({ kind: 'stopped' })
    expect(talk.thread('scout')).toEqual({ botId: 'scout', turns: [] })
    expect(talk.coordination()).toEqual({ running: [] })
    expect(talk.interrupt('scout')).toEqual({ kind: 'idle' })
    release()
    expect(sendCopy({ kind: 'stopped' }, 'Scout')).toBe('Stopped')
    expect(sendCopy({ kind: 'not_teammate' }, 'Chief')).toBe('Chief assigns other bots')
    talk.close()
    roster.close()
  })

  it('does not insert an ok turn after abort', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    let release: () => void = () => undefined
    let started: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: async () => {
        started()
        await held
        return { kind: 'ok', body: 'should not persist' }
      },
      id: ids(),
      now: () => 1
    })
    const assigned = talk.assign({ botId: 'scout', body: 'draft the outline' })
    await began
    expect(talk.interrupt('scout')).toEqual({ kind: 'ok' })
    release()
    expect(await assigned).toEqual({ kind: 'stopped' })
    expect(talk.thread('scout')).toEqual({ botId: 'scout', turns: [] })
    talk.close()
    roster.close()
  })

  it('close aborts in-flight work and writes nothing', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    let started: () => void = () => undefined
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: async ({ signal }) => {
        started()
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { kind: 'stopped' }
      },
      id: ids(),
      now: () => 1
    })
    const assigned = talk.assign({ botId: 'scout', body: 'draft the outline' })
    await began
    talk.close()
    expect(await assigned).toEqual({ kind: 'stopped' })
    const reopened = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: reply('unused')
    })
    expect(reopened.thread('scout')).toEqual({ botId: 'scout', turns: [] })
    reopened.close()
    roster.close()
  })

  it('does not invent a silent external side-effect API', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: reply('ok')
    })
    const storeKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(talk))
    expect(storeKeys.includes('assign')).toBe(true)
    expect(storeKeys.includes('interrupt')).toBe(true)
    expect(storeKeys.includes('coordination')).toBe(true)
    expect(storeKeys.includes('room')).toBe(true)
    expect(storeKeys.includes('roomSend')).toBe(true)
    expect(storeKeys.includes('post')).toBe(false)
    expect(storeKeys.includes('buy')).toBe(false)
    expect(storeKeys.includes('approve')).toBe(false)
    const ipc = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8')
    const api = readFileSync(new URL('../shared/cohort.ts', import.meta.url), 'utf8')
    const prime = readFileSync(new URL('./prime.ts', import.meta.url), 'utf8')
    expect(ipc.includes('cohort:assign')).toBe(true)
    expect(ipc.includes('cohort:interrupt')).toBe(true)
    expect(ipc.includes('cohort:coordination')).toBe(true)
    expect(ipc.includes('cohort:room')).toBe(true)
    expect(ipc.includes('cohort:room-send')).toBe(true)
    expect(api.includes('assign:')).toBe(true)
    expect(api.includes('interrupt:')).toBe(true)
    expect(api.includes('coordination:')).toBe(true)
    expect(api.includes('room:')).toBe(true)
    expect(api.includes('roomSend:')).toBe(true)
    for (const source of [ipc, api]) {
      expect(source.includes('cohort:post')).toBe(false)
      expect(source.includes('cohort:buy')).toBe(false)
    }
    expect(ipc.includes('cohort:approve')).toBe(true)
    expect(ipc.includes('cohort:request-approval')).toBe(true)
    expect(prime.includes("noTools: 'all'")).toBe(true)
    expect(prime.includes('defaultTools: []')).toBe(true)
    expect(() => parseCoordination({ running: [], apiKey: 'sk' })).toThrow('secret field')
    expect(() => parseInterruptResult({ kind: 'ok', key: 'sk' })).toThrow('secret field')
    talk.close()
    roster.close()
  })
})
