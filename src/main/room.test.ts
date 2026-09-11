import { afterEach, describe, expect, it } from 'vitest'
import {
  BODY_MAX,
  parseMessageId,
  parseRoom,
  parseRoomSendResult,
  roomTurnBody,
  talkStopTarget
} from '../shared/talk'
import { RosterStore } from './roster'
import { openTalkDb } from './db'
import { roomLines, turns } from './schema'
import { TalkStore } from './talk'
import { chiefKnown, ids, reply, talkHomes } from './talk-test-util'

const { tempHome, cleanup } = talkHomes()

afterEach(cleanup)

describe('shared room', () => {
  it('formats room history as owner and bot ids', () => {
    expect(roomTurnBody([], 'hello room')).toBe('hello room')
    expect(
      roomTurnBody(
        [
          {
            id: parseMessageId('m1'),
            speaker: { kind: 'owner' },
            body: 'hello room',
            createdAt: 1
          },
          {
            id: parseMessageId('m2'),
            speaker: { kind: 'bot', botId: 'chief' },
            body: 'hi from Chief',
            createdAt: 1
          }
        ],
        'scout, take the outline'
      )
    ).toBe('owner: hello room\nchief: hi from Chief\nowner: scout, take the outline')
  })

  it('starts empty and stays off the 1:1 turns table', () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(talk.room()).toEqual({ lines: [] })
    expect(talk.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    talk.close()
  })

  it('room send persists speaker identity and reopen returns it', async () => {
    const home = tempHome()
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('hi from Chief'),
      id: ids(),
      now: () => 1
    })
    expect(await talk.roomSend({ botId: 'chief', body: 'hello room' })).toEqual({
      kind: 'ok',
      room: {
        lines: [
          { id: 'm1', speaker: { kind: 'owner' }, body: 'hello room', createdAt: 1 },
          {
            id: 'm2',
            speaker: { kind: 'bot', botId: 'chief' },
            body: 'hi from Chief',
            createdAt: 1
          }
        ]
      }
    })
    expect(talk.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    talk.close()
    const reopened = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(reopened.room()).toEqual({
      lines: [
        { id: 'm1', speaker: { kind: 'owner' }, body: 'hello room', createdAt: 1 },
        {
          id: 'm2',
          speaker: { kind: 'bot', botId: 'chief' },
          body: 'hi from Chief',
          createdAt: 1
        }
      ]
    })
    expect(reopened.thread('chief')).toEqual({ botId: 'chief', turns: [] })
    reopened.close()
  })

  it('owner picks who answers; 1:1 threads stay unchanged', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    const seen: { botId: string; ownerBody: string }[] = []
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: async ({ prior, ownerBody }) => {
        seen.push({ botId: prior.botId, ownerBody })
        return { kind: 'ok', body: `hi from ${prior.botId}` }
      },
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'chief', body: 'private' })
    expect(await talk.roomSend({ botId: 'chief', body: 'hello room' })).toEqual({
      kind: 'ok',
      room: {
        lines: [
          { id: 'm3', speaker: { kind: 'owner' }, body: 'hello room', createdAt: 1 },
          {
            id: 'm4',
            speaker: { kind: 'bot', botId: 'chief' },
            body: 'hi from chief',
            createdAt: 1
          }
        ]
      }
    })
    expect(await talk.roomSend({ botId: 'scout', body: 'scout, take the outline' })).toEqual({
      kind: 'ok',
      room: {
        lines: [
          { id: 'm3', speaker: { kind: 'owner' }, body: 'hello room', createdAt: 1 },
          {
            id: 'm4',
            speaker: { kind: 'bot', botId: 'chief' },
            body: 'hi from chief',
            createdAt: 1
          },
          { id: 'm5', speaker: { kind: 'owner' }, body: 'scout, take the outline', createdAt: 1 },
          {
            id: 'm6',
            speaker: { kind: 'bot', botId: 'scout' },
            body: 'hi from scout',
            createdAt: 1
          }
        ]
      }
    })
    expect(seen[1]).toEqual({ botId: 'chief', ownerBody: 'hello room' })
    expect(seen[2]).toEqual({
      botId: 'scout',
      ownerBody: roomTurnBody(
        [
          {
            id: parseMessageId('m3'),
            speaker: { kind: 'owner' },
            body: 'hello room',
            createdAt: 1
          },
          {
            id: parseMessageId('m4'),
            speaker: { kind: 'bot', botId: 'chief' },
            body: 'hi from chief',
            createdAt: 1
          }
        ],
        'scout, take the outline'
      )
    })
    expect(talk.thread('chief').turns).toEqual([
      {
        owner: { id: 'm1', body: 'private', createdAt: 1 },
        bot: { id: 'm2', body: 'hi from chief', createdAt: 1 }
      }
    ])
    expect(talk.thread('scout')).toEqual({ botId: 'scout', turns: [] })
    const db = openTalkDb(home)
    try {
      expect(db.select().from(turns).all()).toEqual([
        {
          ownerId: 'm1',
          botId: 'chief',
          ownerBody: 'private',
          botLineId: 'm2',
          botBody: 'hi from chief',
          createdAt: 1
        }
      ])
      expect(db.select().from(roomLines).all()).toEqual([
        {
          n: 1,
          id: 'm3',
          speakerKind: 'owner',
          speakerBotId: null,
          body: 'hello room',
          createdAt: 1
        },
        {
          n: 2,
          id: 'm4',
          speakerKind: 'bot',
          speakerBotId: 'chief',
          body: 'hi from chief',
          createdAt: 1
        },
        {
          n: 3,
          id: 'm5',
          speakerKind: 'owner',
          speakerBotId: null,
          body: 'scout, take the outline',
          createdAt: 1
        },
        {
          n: 4,
          id: 'm6',
          speakerKind: 'bot',
          speakerBotId: 'scout',
          body: 'hi from scout',
          createdAt: 1
        }
      ])
    } finally {
      db.$client.close()
    }
    talk.close()
    roster.close()
  })

  it('1:1 send does not write room lines', async () => {
    const talk = new TalkStore({
      home: tempHome(),
      known: chiefKnown,
      turn: reply('hi from Chief'),
      id: ids(),
      now: () => 1
    })
    await talk.send({ botId: 'chief', body: 'hello' })
    expect(talk.room()).toEqual({ lines: [] })
    talk.close()
  })

  it('empty, too-long, unknown, and failed room sends write nothing', async () => {
    const home = tempHome()
    let fail = true
    const talk = new TalkStore({
      home,
      known: chiefKnown,
      turn: async () => {
        if (fail) return { kind: 'turn_failed', detail: 'timeout' }
        return { kind: 'ok', body: 'ok' }
      },
      id: ids(),
      now: () => 1
    })
    expect(await talk.roomSend({ botId: 'chief', body: '   ' })).toEqual({ kind: 'empty' })
    expect(await talk.roomSend({ botId: 'chief', body: 'x'.repeat(BODY_MAX + 1) })).toEqual({
      kind: 'too_long'
    })
    expect(await talk.roomSend({ botId: 'ghost', body: 'hello' })).toEqual({ kind: 'unknown_bot' })
    expect(await talk.roomSend({ botId: 'chief', body: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
    expect(talk.room()).toEqual({ lines: [] })
    fail = false
    expect(await talk.roomSend({ botId: 'chief', body: 'hello' })).toEqual({
      kind: 'ok',
      room: {
        lines: [
          { id: 'm1', speaker: { kind: 'owner' }, body: 'hello', createdAt: 1 },
          { id: 'm2', speaker: { kind: 'bot', botId: 'chief' }, body: 'ok', createdAt: 1 }
        ]
      }
    })
    talk.close()
  })

  it('overlapping room send returns busy and interrupt writes nothing', async () => {
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
    const first = talk.roomSend({ botId: 'scout', body: 'hello room' })
    await began
    expect(await talk.roomSend({ botId: 'chief', body: 'again' })).toEqual({ kind: 'busy' })
    expect(await talk.send({ botId: 'scout', body: 'private' })).toEqual({ kind: 'busy' })
    expect(talk.coordination()).toEqual({
      running: [{ botId: 'scout', brief: 'hello room' }]
    })
    expect(talk.interrupt('scout')).toEqual({ kind: 'ok' })
    expect(await first).toEqual({ kind: 'stopped' })
    expect(talk.room()).toEqual({ lines: [] })
    expect(talk.thread('scout')).toEqual({ botId: 'scout', turns: [] })
    expect(talk.coordination()).toEqual({ running: [] })
    release()
    talk.close()
    roster.close()
  })

  it('does not insert an ok room turn after abort', async () => {
    const home = tempHome()
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
      known: chiefKnown,
      turn: async () => {
        started()
        await held
        return { kind: 'ok', body: 'should not persist' }
      },
      id: ids(),
      now: () => 1
    })
    const sent = talk.roomSend({ botId: 'chief', body: 'hello room' })
    await began
    expect(talk.interrupt('chief')).toEqual({ kind: 'ok' })
    release()
    expect(await sent).toEqual({ kind: 'stopped' })
    expect(talk.room()).toEqual({ lines: [] })
    talk.close()
  })

  it('close aborts an in-flight room turn and writes nothing', async () => {
    const home = tempHome()
    let started: () => void = () => undefined
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const talk = new TalkStore({
      home,
      known: chiefKnown,
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
    const sent = talk.roomSend({ botId: 'chief', body: 'hello room' })
    await began
    talk.close()
    expect(await sent).toEqual({ kind: 'stopped' })
    const reopened = new TalkStore({
      home,
      known: chiefKnown,
      turn: reply('unused')
    })
    expect(reopened.room()).toEqual({ lines: [] })
    reopened.close()
  })

  it('stop targets the frozen flight bot, not a later To', () => {
    expect(talkStopTarget('scout', 'chief')).toBe('scout')
    expect(talkStopTarget(null, 'chief')).toBe('chief')
  })

  it('interrupt of another bot does not abort the room flight', async () => {
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
        return { kind: 'ok', body: 'from scout' }
      },
      id: ids(),
      now: () => 1
    })
    const sent = talk.roomSend({ botId: 'scout', body: 'hello room' })
    await began
    expect(talk.interrupt('chief')).toEqual({ kind: 'idle' })
    expect(talk.coordination()).toEqual({
      running: [{ botId: 'scout', brief: 'hello room' }]
    })
    release()
    expect(await sent).toEqual({
      kind: 'ok',
      room: {
        lines: [
          { id: 'm1', speaker: { kind: 'owner' }, body: 'hello room', createdAt: 1 },
          { id: 'm2', speaker: { kind: 'bot', botId: 'scout' }, body: 'from scout', createdAt: 1 }
        ]
      }
    })
    talk.close()
    roster.close()
  })

  it('rejects a room payload that smuggles apiKey', () => {
    expect(() => parseRoom({ lines: [], apiKey: 'sk' })).toThrow('secret field')
    expect(() => parseRoomSendResult({ kind: 'ok', room: { lines: [] }, key: 'sk' })).toThrow(
      'secret field'
    )
  })
})
