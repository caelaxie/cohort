import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { HATCH_ID } from '../shared/roster'
import { BODY_MAX, parseSendResult, parseThread } from '../shared/talk'
import { stateDbPath, talkDbPath } from './paths'
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

function hatchKnown(id: string): boolean {
  return id === HATCH_ID
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('TalkStore', () => {
  it('starts with an empty Hatch thread', () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async () => 'unused'
    })
    expect(talk.thread('hatch')).toEqual({ botId: 'hatch', turns: [] })
    talk.close()
  })

  it('send persists a closed turn and reopen returns it', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: hatchKnown,
      turn: async () => 'hi from Hatch',
      id: ids(),
      now: () => 1
    })
    expect(await talk.send({ botId: 'hatch', body: 'hello' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'hatch',
        turns: [
          {
            owner: { id: 'm1', body: 'hello', createdAt: 1 },
            bot: { id: 'm2', body: 'hi from Hatch', createdAt: 1 }
          }
        ]
      }
    })
    talk.close()
    const reopened = new TalkStore({
      home,
      known: hatchKnown,
      turn: async () => 'unused'
    })
    expect(reopened.thread('hatch')).toEqual({
      botId: 'hatch',
      turns: [
        {
          owner: { id: 'm1', body: 'hello', createdAt: 1 },
          bot: { id: 'm2', body: 'hi from Hatch', createdAt: 1 }
        }
      ]
    })
    reopened.close()
  })

  it('reopen keeps owner then Hatch when ids sort the other way', async () => {
    const home = tempHome()
    const seq = ['z-owner', 'a-bot']
    let i = 0
    const talk = new TalkStore({
      home,
      known: hatchKnown,
      turn: async () => 'hi from Hatch',
      id: () => seq[i++],
      now: () => 1
    })
    await talk.send({ botId: 'hatch', body: 'hello' })
    talk.close()
    const reopened = new TalkStore({
      home,
      known: hatchKnown,
      turn: async () => 'unused'
    })
    expect(reopened.thread('hatch').turns[0]).toEqual({
      owner: { id: 'z-owner', body: 'hello', createdAt: 1 },
      bot: { id: 'a-bot', body: 'hi from Hatch', createdAt: 1 }
    })
    reopened.close()
  })

  it('second send appends after the first turn', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async ({ ownerBody }) => `re:${ownerBody}`,
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'hatch', body: 'one' })
    expect(await talk.send({ botId: 'hatch', body: 'two' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'hatch',
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
      known: hatchKnown,
      turn: async () => {
        calls += 1
        started()
        await held
        return 'done'
      },
      id: ids(),
      now: () => 1
    })
    const first = talk.send({ botId: 'hatch', body: 'hello' })
    await began
    expect(await talk.send({ botId: 'hatch', body: 'again' })).toEqual({ kind: 'busy' })
    release()
    expect(await first).toEqual({
      kind: 'ok',
      thread: {
        botId: 'hatch',
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
      known: hatchKnown,
      turn: async () => 'nope'
    })
    expect(await talk.send({ botId: 'hatch', body: '   ' })).toEqual({ kind: 'empty' })
    expect(talk.thread('hatch')).toEqual({ botId: 'hatch', turns: [] })
    talk.close()
    expect(existsSync(talkDbPath(home))).toBe(true)
  })

  it('too-long body writes nothing', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async () => 'nope'
    })
    expect(await talk.send({ botId: 'hatch', body: 'x'.repeat(BODY_MAX + 1) })).toEqual({
      kind: 'too_long'
    })
    expect(talk.thread('hatch').turns).toEqual([])
    talk.close()
  })

  it('needs_login writes nothing', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async () => {
        throw new Error('needs_login')
      }
    })
    expect(await talk.send({ botId: 'hatch', body: 'hello' })).toEqual({ kind: 'needs_login' })
    expect(talk.thread('hatch').turns).toEqual([])
    talk.close()
  })

  it('turn_failed writes nothing and later send works', async () => {
    let fail = true
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async () => {
        if (fail) throw new Error('timeout')
        return 'ok'
      },
      id: ids(),
      now: () => 1
    })
    expect(await talk.send({ botId: 'hatch', body: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
    expect(talk.thread('hatch').turns).toEqual([])
    fail = false
    expect(await talk.send({ botId: 'hatch', body: 'hello' })).toEqual({
      kind: 'ok',
      thread: {
        botId: 'hatch',
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

  it('blank turn reply is turn_failed and writes nothing', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async () => '  '
    })
    expect(await talk.send({ botId: 'hatch', body: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'empty reply'
    })
    expect(talk.thread('hatch').turns).toEqual([])
    talk.close()
  })

  it('unknown bot send returns unknown_bot and thread throws', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: hatchKnown,
      turn: async () => 'nope'
    })
    expect(await talk.send({ botId: 'ghost', body: 'hello' })).toEqual({ kind: 'unknown_bot' })
    expect(() => talk.thread('ghost')).toThrow('unknown bot')
    talk.close()
  })

  it('does not create a teammates table', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: hatchKnown,
      turn: async () => 'hi',
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'hatch', body: 'hello' })
    talk.close()
    expect(existsSync(stateDbPath(home))).toBe(false)
    const db = new Database(talkDbPath(home), { readonly: true, fileMustExist: true })
    try {
      const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as { name: string }[]
      expect(names).toEqual([{ name: 'messages' }])
    } finally {
      db.close()
    }
  })
})

describe('parseThread', () => {
  it('rejects a payload that smuggles apiKey', () => {
    expect(() =>
      parseThread({
        botId: 'hatch',
        turns: [],
        apiKey: 'sk'
      })
    ).toThrow('secret field')
  })
})

describe('parseSendResult', () => {
  it('rejects a result that smuggles key', () => {
    expect(() =>
      parseSendResult({ kind: 'ok', thread: { botId: 'hatch', turns: [] }, key: 'sk' })
    ).toThrow('secret field')
  })
})
