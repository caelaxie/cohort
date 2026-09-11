import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ACTION_CLASSES,
  PAYLOAD_MAX,
  SUMMARY_MAX,
  parseActionClass,
  parseApprovalAsk,
  parseApprovalVerdict,
  parseApprovals,
  parseDecideResult
} from '../shared/approval'
import { parseBotId } from '../shared/roster'
import { ApprovalStore } from './approval'
import { homeAt } from './paths'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-approval-'))
  homes.push(home)
  return home
}

function ids(): () => string {
  let n = 0
  return () => `a${++n}`
}

function chiefKnown(id: string): boolean {
  return id === 'chief'
}

function ask(action: (typeof ACTION_CLASSES)[number] = 'send') {
  return {
    botId: 'chief',
    action,
    summary: 'Email Alex the recap',
    payload: 'to: alex@example.com'
  }
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('ApprovalStore', () => {
  it('starts with no pending and no audit', () => {
    const store = new ApprovalStore({ home: tempHome(), known: chiefKnown })
    expect(store.snapshot()).toEqual({ pending: [], audit: [] })
    store.close()
  })

  it('require makes the pending request visible before a decision', async () => {
    const store = new ApprovalStore({
      home: tempHome(),
      known: chiefKnown,
      id: ids(),
      now: () => 1
    })
    const pending = store.require(ask())
    expect(store.snapshot().pending).toEqual([
      {
        id: 'a1',
        botId: 'chief',
        action: 'send',
        summary: 'Email Alex the recap',
        payload: 'to: alex@example.com',
        createdAt: 1
      }
    ])
    expect(store.snapshot().audit).toEqual([])
    store.deny('a1')
    await pending
    store.close()
  })

  it('gated does not run the side effect until approve', async () => {
    const store = new ApprovalStore({ home: tempHome(), known: chiefKnown, id: ids() })
    let ran = false
    const done = store.gated(ask(), () => {
      ran = true
      return 'sent'
    })
    expect(store.snapshot().pending).toHaveLength(1)
    expect(ran).toBe(false)
    await expect(Promise.race([done, Promise.resolve('waiting')])).resolves.toBe('waiting')
    store.approve(store.snapshot().pending[0].id)
    await expect(done).resolves.toMatchObject({ kind: 'approved', value: 'sent' })
    expect(ran).toBe(true)
    store.close()
  })

  it('deny leaves no side effect and is the default on close', async () => {
    const home = tempHome()
    const store = new ApprovalStore({ home, known: chiefKnown, id: ids(), now: () => 1 })
    let ran = false
    const done = store.gated(ask('delete'), () => {
      ran = true
      return 'deleted'
    })
    store.close()
    await expect(done).resolves.toEqual({
      kind: 'denied',
      request: {
        id: 'a1',
        botId: 'chief',
        action: 'delete',
        summary: 'Email Alex the recap',
        payload: 'to: alex@example.com',
        createdAt: 1
      }
    })
    expect(ran).toBe(false)
    const reopened = new ApprovalStore({ home, known: chiefKnown })
    expect(reopened.snapshot().pending).toEqual([])
    expect(reopened.snapshot().audit).toEqual([
      {
        id: 'a2',
        request: {
          id: 'a1',
          botId: 'chief',
          action: 'delete',
          summary: 'Email Alex the recap',
          payload: 'to: alex@example.com',
          createdAt: 1
        },
        decision: 'denied',
        decidedAt: 1
      }
    ])
    reopened.close()
  })

  it('approve vs deny are auditable as requested vs decision', async () => {
    let t = 0
    const store = new ApprovalStore({
      home: tempHome(),
      known: chiefKnown,
      id: ids(),
      now: () => ++t
    })
    const send = store.gated(ask('send'), () => 'sent')
    const buy = store.gated(ask('buy'), () => 'bought')
    expect(store.snapshot().pending.map((item) => item.action)).toEqual(['send', 'buy'])
    expect(store.approve(store.snapshot().pending[0].id)).toMatchObject({ kind: 'ok' })
    expect(store.deny(store.snapshot().pending[0].id)).toMatchObject({ kind: 'ok' })
    await expect(send).resolves.toMatchObject({ kind: 'approved', value: 'sent' })
    await expect(buy).resolves.toMatchObject({ kind: 'denied' })
    expect(store.snapshot().audit.map((item) => [item.request.action, item.decision])).toEqual([
      ['send', 'approved'],
      ['buy', 'denied']
    ])
    expect(store.snapshot().audit[0]?.request.payload).toBe('to: alex@example.com')
    expect(store.snapshot().audit[0]?.request.summary).toBe('Email Alex the recap')
    store.close()
  })

  it('denyAll dismisses every pending request as denied', async () => {
    const store = new ApprovalStore({ home: tempHome(), known: chiefKnown, id: ids() })
    let ran = 0
    const first = store.gated(ask('post'), () => {
      ran += 1
    })
    const second = store.gated(ask('buy'), () => {
      ran += 1
    })
    const after = store.denyAll()
    expect(after.pending).toEqual([])
    expect(after.audit.map((item) => item.decision)).toEqual(['denied', 'denied'])
    await first
    await second
    expect(ran).toBe(0)
    store.close()
  })

  it('unknown approve or deny is safe and does not invent a decision', async () => {
    const store = new ApprovalStore({ home: tempHome(), known: chiefKnown, id: ids() })
    const done = store.require(ask())
    expect(store.approve('missing')).toEqual({ kind: 'unknown' })
    expect(store.deny('missing')).toEqual({ kind: 'unknown' })
    expect(store.snapshot().audit).toEqual([])
    expect(store.snapshot().pending).toHaveLength(1)
    store.deny(store.snapshot().pending[0].id)
    await done
    expect(store.approve(store.snapshot().audit[0]?.request.id)).toEqual({ kind: 'unknown' })
    expect(store.snapshot().audit).toHaveLength(1)
    expect(store.snapshot().audit[0]?.decision).toBe('denied')
    store.close()
  })

  it('first decision wins', async () => {
    const store = new ApprovalStore({ home: tempHome(), known: chiefKnown, id: ids() })
    const done = store.require(ask())
    const id = store.snapshot().pending[0].id
    expect(store.deny(id).kind).toBe('ok')
    expect(store.approve(id).kind).toBe('unknown')
    await expect(done).resolves.toMatchObject({ kind: 'denied' })
    expect(store.snapshot().audit).toHaveLength(1)
    expect(store.snapshot().audit[0]?.decision).toBe('denied')
    store.close()
  })

  it('reopen keeps leftover pending and later audit', () => {
    const home = tempHome()
    const seed = new ApprovalStore({ home, known: chiefKnown })
    seed.close()
    const db = new Database(homeAt(home).approvalDb)
    db.prepare(
      `INSERT INTO pending_approvals (id, bot_id, action, summary, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('left', 'chief', 'post', 'Email Alex the recap', 'to: alex@example.com', 4)
    db.close()
    const store = new ApprovalStore({ home, known: chiefKnown, id: ids(), now: () => 8 })
    expect(store.snapshot().pending[0]?.action).toBe('post')
    expect(store.approve(store.snapshot().pending[0].id).kind).toBe('ok')
    store.close()
    const again = new ApprovalStore({ home, known: chiefKnown })
    expect(again.snapshot().pending).toEqual([])
    expect(again.snapshot().audit[0]).toMatchObject({
      request: { action: 'post', summary: 'Email Alex the recap' },
      decision: 'approved',
      decidedAt: 8
    })
    again.close()
  })

  it('writes approval.sqlite under home', async () => {
    const home = tempHome()
    const store = new ApprovalStore({ home, known: chiefKnown, id: ids() })
    const done = store.require(ask())
    store.deny(store.snapshot().pending[0].id)
    await done
    store.close()
    expect(existsSync(homeAt(home).approvalDb)).toBe(true)
  })

  it('rejects an unknown bot before anything is pending', async () => {
    const store = new ApprovalStore({ home: tempHome(), known: chiefKnown })
    await expect(store.require({ ...ask(), botId: parseBotId('ghost') })).rejects.toThrow(
      'unknown bot'
    )
    expect(store.snapshot()).toEqual({ pending: [], audit: [] })
    store.close()
  })

  it('notifies on request and on decide', async () => {
    let n = 0
    const store = new ApprovalStore({
      home: tempHome(),
      known: chiefKnown,
      id: ids(),
      onChange: () => {
        n += 1
      }
    })
    const done = store.require(ask())
    expect(n).toBe(1)
    store.deny(store.snapshot().pending[0].id)
    expect(n).toBe(2)
    await done
    store.close()
  })
})

describe('approval parsers', () => {
  it('accepts each action class', () => {
    for (const action of ACTION_CLASSES) {
      expect(parseActionClass(action)).toBe(action)
      expect(parseApprovalAsk(ask(action)).action).toBe(action)
    }
  })

  it('rejects secrets, empty summary, and unknown action', () => {
    expect(() => parseApprovalAsk({ ...ask(), key: 'sk' })).toThrow('secret field')
    expect(() => parseApprovalAsk({ ...ask(), summary: '   ' })).toThrow('empty summary')
    expect(() => parseApprovalAsk({ ...ask(), action: 'browse' })).toThrow('invalid action')
    expect(() => parseApprovalAsk({ ...ask(), summary: 'x'.repeat(SUMMARY_MAX + 1) })).toThrow(
      'summary too long'
    )
    expect(() => parseApprovalAsk({ ...ask(), payload: 'x'.repeat(PAYLOAD_MAX + 1) })).toThrow(
      'payload too long'
    )
  })

  it('round-trips snapshot and verdict without secret fields', async () => {
    const store = new ApprovalStore({
      home: tempHome(),
      known: chiefKnown,
      id: ids(),
      now: () => 1
    })
    const done = store.require(ask())
    const listed = parseApprovals(store.snapshot())
    expect(JSON.stringify(listed).includes('"key"')).toBe(false)
    const decided = parseDecideResult(store.deny(listed.pending[0].id))
    expect(decided.kind).toBe('ok')
    if (decided.kind === 'ok') {
      expect(decided.approvals.audit[0]?.decision).toBe('denied')
    }
    expect(parseApprovalVerdict(await done).kind).toBe('denied')
    store.close()
  })
})
