import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ACTION_CLASSES, parseApprovalAsk } from '../shared/approval'
import {
  SHARED_PROFILE,
  parseComputerResult,
  parseComputerStatus,
  parseSharedProfile
} from '../shared/computer'
import { ApprovalStore } from './approval'
import { Computer, sharedDriver, type BrowserDriver } from './computer'
import { TalkStore } from './talk'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-computer-'))
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

function approvals(home = tempHome()): ApprovalStore {
  return new ApprovalStore({ home, known: chiefKnown, id: ids() })
}

function ask(action: (typeof ACTION_CLASSES)[number] = 'send') {
  return {
    botId: 'chief',
    action,
    summary: 'Email Alex the recap',
    payload: 'to: alex@example.com'
  }
}

function heldDriver(): {
  readonly driver: BrowserDriver
  readonly started: Promise<void>
  readonly acts: number[]
} {
  let started: () => void = () => undefined
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const acts: number[] = []
  return {
    acts,
    started: began,
    driver: {
      async act(_ask, signal) {
        started()
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        if (signal.aborted) {
          throw new Error('stopped')
        }
        acts.push(1)
        return { ok: true }
      },
      dispose() {
        return
      }
    }
  }
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('Computer', () => {
  it('is this Mac while open and uses the shared default session', () => {
    const store = approvals()
    const computer = new Computer({ approvals: store })
    expect(parseComputerStatus(computer.status())).toEqual({
      kind: 'ready',
      profile: SHARED_PROFILE
    })
    expect(parseSharedProfile({ kind: 'shared', session: 'default' })).toEqual(SHARED_PROFILE)
    expect(() => parseSharedProfile({ kind: 'shared', session: 'persist:bot-chief' })).toThrow(
      'invalid profile'
    )
    expect(() => parseSharedProfile({ kind: 'bot', session: 'default', botId: 'chief' })).toThrow(
      'invalid profile'
    )
    computer.stop()
    store.close()
  })

  it('two bots share one login surface, not a per-bot profile', async () => {
    const store = new ApprovalStore({
      home: tempHome(),
      known: (id) => id === 'chief' || id === 'scout',
      id: ids()
    })
    const computer = new Computer({ approvals: store })
    const chief = computer.use(ask('post'))
    const scout = computer.use({ ...ask('post'), botId: 'scout', summary: 'Post the recap' })
    expect(computer.status()).toEqual({ kind: 'ready', profile: SHARED_PROFILE })
    expect(store.snapshot().pending.map((item) => item.botId)).toEqual(['chief', 'scout'])
    store.denyAll()
    await chief
    await scout
    expect(computer.status()).toEqual({ kind: 'ready', profile: SHARED_PROFILE })
    computer.stop()
    store.close()
  })

  it('send, post, buy, and delete do not run without gated approve', async () => {
    for (const action of ACTION_CLASSES) {
      const store = approvals()
      let ran = 0
      const computer = new Computer({
        approvals: store,
        driver: {
          act() {
            ran += 1
            return { ok: true }
          },
          dispose() {
            return
          }
        }
      })
      const done = computer.use(ask(action))
      expect(store.snapshot().pending).toHaveLength(1)
      expect(store.snapshot().pending[0]?.action).toBe(action)
      expect(ran).toBe(0)
      await expect(Promise.race([done, Promise.resolve('waiting')])).resolves.toBe('waiting')
      store.deny(store.snapshot().pending[0].id)
      expect(parseComputerResult(await done)).toEqual({ kind: 'denied' })
      expect(ran).toBe(0)
      computer.stop()
      store.close()
    }
  })

  it('approve is the only path that reaches the driver', async () => {
    const store = approvals()
    let ran = 0
    const computer = new Computer({
      approvals: store,
      driver: {
        act(input) {
          ran += 1
          return { action: input.action }
        },
        dispose() {
          return
        }
      }
    })
    const done = computer.use(ask('buy'))
    expect(ran).toBe(0)
    store.approve(store.snapshot().pending[0].id)
    await expect(done).resolves.toEqual({ kind: 'done', value: { action: 'buy' } })
    expect(ran).toBe(1)
    expect(store.snapshot().audit[0]?.decision).toBe('approved')
    computer.stop()
    store.close()
  })

  it('hands are unavailable after stop and the driver does not run', async () => {
    const store = approvals()
    let ran = 0
    const computer = new Computer({
      approvals: store,
      driver: {
        act() {
          ran += 1
          return { ok: true }
        },
        dispose() {
          return
        }
      }
    })
    computer.stop()
    expect(computer.status()).toEqual({ kind: 'stopped' })
    expect(parseComputerStatus(computer.status())).toEqual({ kind: 'stopped' })
    await expect(computer.use(ask())).resolves.toEqual({ kind: 'unavailable' })
    expect(ran).toBe(0)
    expect(store.snapshot().pending).toEqual([])
    store.close()
  })

  it('stop tears down an in-flight act and leaves no side effect', async () => {
    const store = approvals()
    const held = heldDriver()
    const computer = new Computer({ approvals: store, driver: held.driver })
    const done = computer.use(ask('delete'))
    store.approve(store.snapshot().pending[0].id)
    await held.started
    computer.stop()
    await expect(done).resolves.toEqual({ kind: 'unavailable' })
    expect(held.acts).toEqual([])
    expect(computer.status()).toEqual({ kind: 'stopped' })
    await expect(computer.use(ask())).resolves.toEqual({ kind: 'unavailable' })
    store.close()
  })

  it('stop while waiting for approval denies and never runs the driver', async () => {
    const store = approvals()
    let ran = 0
    const computer = new Computer({
      approvals: store,
      driver: {
        act() {
          ran += 1
          return { ok: true }
        },
        dispose() {
          return
        }
      }
    })
    const done = computer.use(ask('send'))
    expect(store.snapshot().pending).toHaveLength(1)
    computer.stop()
    store.close()
    await expect(done).resolves.toEqual({ kind: 'denied' })
    expect(ran).toBe(0)
  })

  it('disposed shared driver cannot act', () => {
    const driver = sharedDriver()
    driver.dispose()
    const signal = new AbortController().signal
    expect(() => driver.act(parseApprovalAsk(ask()), signal)).toThrow('stopped')
  })

  it('quit tears down in-flight talk and computer work', async () => {
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
      }
    })
    const store = new ApprovalStore({ home, known: chiefKnown, id: ids() })
    const computer = new Computer({ approvals: store })
    const flight = talk.send({ botId: 'chief', body: 'hello' })
    const hands = computer.use(ask('post'))
    await began
    computer.stop()
    talk.close()
    store.close()
    expect(await flight).toEqual({ kind: 'stopped' })
    expect(await hands).toEqual({ kind: 'denied' })
    expect(computer.status()).toEqual({ kind: 'stopped' })
    await expect(computer.use(ask())).resolves.toEqual({ kind: 'unavailable' })
  })
})

describe('computer wiring', () => {
  it('owns hands from registerIpc and stops them on quit', () => {
    const ipc = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8')
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const prime = readFileSync(new URL('./prime.ts', import.meta.url), 'utf8')
    expect(ipc.includes('new Computer')).toBe(true)
    expect(ipc.includes('computer.stop()')).toBe(true)
    expect(ipc.indexOf('computer.stop()')).toBeLessThan(ipc.indexOf('talk.close()'))
    expect(ipc.includes('partition:')).toBe(false)
    expect(index.includes('partition:')).toBe(false)
    expect(prime.includes("noTools: 'all'")).toBe(true)
    expect(ipc.includes('cohort:post')).toBe(false)
    expect(ipc.includes('cohort:buy')).toBe(false)
  })
})
