import { createServer } from 'node:http'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHIEF, parseTeammate } from '../shared/roster'
import { parseMessageId } from '../shared/talk'
import { botSystemPrompt, CHIEF_SYSTEM } from './chief-prompt'
import type { Endpoint } from './kernel'
import { assistantText, primeCatalogPath, primeTurn, type PrimeModule } from './prime'
import { RosterStore } from './roster'
import { TalkStore } from './talk'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-prime-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const endpoint: Endpoint = {
  model: 'mock-hatch',
  baseUrl: 'http://127.0.0.1:18765/v1',
  key: 'sk-test'
}

const emptyPrior = { botId: 'chief' as const, turns: [] }

function fakeModule(options?: {
  readonly reply?: string
  readonly prompt?: (text: string) => Promise<void>
  readonly create?: () => Promise<void>
  readonly assistant?: unknown
}): {
  module: PrimeModule
  prompts: string[]
  systemPrompts: string[]
  seeded: unknown[]
  keys: string[]
  aborted: number
  disposed: number
  opens: number
  subscribed: number
} {
  const prompts: string[] = []
  const systemPrompts: string[] = []
  const seeded: unknown[] = []
  const keys: string[] = []
  let aborted = 0
  let disposed = 0
  let opens = 0
  let subscribed = 0
  const reply = options?.reply ?? 'hi from Chief'
  const module = {
    createAgentSession: async () => {
      if (options?.create) await options.create()
      opens += 1
      let messages: unknown[] = []
      return {
        session: {
          get messages() {
            return messages
          },
          agent: {
            state: {
              get messages() {
                return messages
              },
              set messages(next: unknown[]) {
                messages = [...next]
              }
            }
          },
          prompt: async (text: string) => {
            seeded.push(...messages)
            prompts.push(text)
            if (options?.prompt) {
              await options.prompt(text)
              return
            }
            messages.push(
              options?.assistant ?? {
                role: 'assistant',
                content: [{ type: 'text', text: reply }]
              }
            )
          },
          subscribe: (
            listener: (event: {
              type: string
              assistantMessageEvent?: { type: string; delta?: string }
            }) => void
          ) => {
            subscribed += 1
            listener({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: reply }
            })
            return () => undefined
          },
          abort: async () => {
            aborted += 1
          },
          dispose: () => {
            disposed += 1
          }
        }
      }
    },
    AuthStorage: {
      create: () => ({
        setRuntimeApiKey: (provider: string, key: string) => {
          keys.push(`${provider}:${key}`)
        }
      })
    },
    ModelRegistry: {
      create: () => ({
        getAll: () => [{ id: 'mock-hatch', provider: 'cohort' }],
        find: (_provider: string, id: string) =>
          id === 'mock-hatch' ? { id: 'mock-hatch', provider: 'cohort' } : undefined
      })
    },
    SessionManager: {
      inMemory: (cwd?: string) => ({ cwd })
    },
    DefaultResourceLoader: class {
      constructor(options?: { systemPrompt?: string }) {
        if (typeof options?.systemPrompt === 'string') {
          systemPrompts.push(options.systemPrompt)
        }
      }
      async reload(): Promise<void> {
        return
      }
    },
    SettingsManager: {
      inMemory: (settings?: unknown) => settings
    }
  } as unknown as PrimeModule
  return {
    module,
    prompts,
    systemPrompts,
    seeded,
    keys,
    get aborted() {
      return aborted
    },
    get disposed() {
      return disposed
    },
    get opens() {
      return opens
    },
    get subscribed() {
      return subscribed
    }
  }
}

describe('assistantText', () => {
  it('reads the last assistant text part', () => {
    expect(
      assistantText([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: [{ type: 'text', text: ' hi from Chief ' }] }
      ])
    ).toBe('hi from Chief')
  })

  it('does not throw a provider errorMessage', () => {
    expect(() =>
      assistantText([
        {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'sk-test provider boom'
        }
      ])
    ).toThrow('turn failed')
  })
})

describe('primeTurn', () => {
  it('prompts Prime and returns the assistant reply', async () => {
    const home = tempHome()
    const fake = fakeModule()
    const prime = primeTurn({
      bot: () => CHIEF,
      home,
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    expect(
      await prime.turn({
        prior: emptyPrior,
        ownerBody: 'hello'
      })
    ).toEqual({ kind: 'ok', body: 'hi from Chief' })
    expect(fake.prompts).toEqual(['hello'])
    expect(fake.systemPrompts).toEqual([CHIEF_SYSTEM])
    expect(fake.keys).toEqual(['cohort:sk-test'])
    expect(fake.subscribed).toBe(0)
  })

  it('uses the hatched bot name in the system prompt', async () => {
    const scout = parseTeammate({ id: 'scout', name: 'Scout' })
    const fake = fakeModule({ reply: 'hi from Scout' })
    const prime = primeTurn({
      bot: (id) => (id === scout.id ? scout : CHIEF),
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    expect(
      await prime.turn({
        prior: { botId: scout.id, turns: [] },
        ownerBody: 'hello'
      })
    ).toEqual({ kind: 'ok', body: 'hi from Scout' })
    expect(fake.systemPrompts).toEqual([botSystemPrompt(scout)])
    expect(fake.systemPrompts[0]?.includes('You are Scout')).toBe(true)
    expect(fake.systemPrompts[0]?.includes('You are Chief')).toBe(false)
  })

  it('seeds prior turns into the session before the new prompt', async () => {
    const { module, prompts, seeded } = fakeModule()
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => module
    })
    await prime.turn({
      prior: {
        botId: 'chief',
        turns: [
          {
            owner: { id: parseMessageId('m1'), body: 'one', createdAt: 1 },
            bot: { id: parseMessageId('m2'), body: 'a', createdAt: 1 }
          }
        ]
      },
      ownerBody: 'two'
    })
    expect(prompts).toEqual(['two'])
    expect(seeded).toEqual([
      { role: 'user', content: 'one', timestamp: 1 },
      expect.objectContaining({
        role: 'assistant',
        content: [{ type: 'text', text: 'a' }]
      })
    ])
  })

  it('returns needs_login and does not load Prime', async () => {
    let loaded = false
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => null,
      load: async () => {
        loaded = true
        return fakeModule().module
      }
    })
    expect(await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'needs_login'
    })
    expect(loaded).toBe(false)
  })

  it('reuses one live session across turns until close', async () => {
    const fake = fakeModule()
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    await prime.turn({ prior: emptyPrior, ownerBody: 'one' })
    await prime.turn({ prior: emptyPrior, ownerBody: 'two' })
    expect(fake.prompts).toEqual(['one', 'two'])
    expect(fake.opens).toBe(1)
    expect(fake.disposed).toBe(0)
    prime.close()
    expect(fake.disposed).toBe(1)
  })

  it('keeps room and dm on separate live sessions', async () => {
    const fake = fakeModule()
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    await prime.turn({ prior: emptyPrior, ownerBody: 'dm' })
    await prime.roomTurn({ prior: emptyPrior, ownerBody: 'room' })
    expect(fake.opens).toBe(2)
    expect(fake.prompts).toEqual(['dm', 'room'])
    prime.close()
    expect(fake.disposed).toBe(2)
  })

  it('injects the runtime key and does not rewrite auth.json or a dummy apiKey', async () => {
    const home = tempHome()
    const authPath = join(home, 'prime', 'agent', 'auth.json')
    mkdirSync(dirname(authPath), { recursive: true })
    writeFileSync(
      authPath,
      JSON.stringify({ xai: { type: 'api_key', key: 'sk-file' } }, null, 2),
      'utf8'
    )
    const before = readFileSync(authPath, 'utf8')
    const { module, keys } = fakeModule()
    const prime = primeTurn({
      bot: () => CHIEF,
      home,
      endpoint: async () => endpoint,
      load: async () => module
    })
    await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })
    expect(keys).toEqual(['cohort:sk-test'])
    expect(readFileSync(authPath, 'utf8')).toBe(before)
    const catalog = JSON.parse(readFileSync(primeCatalogPath(home), 'utf8')) as {
      providers: { cohort: Record<string, unknown> }
    }
    expect(catalog.providers.cohort.apiKey).toBeUndefined()
    expect(JSON.stringify(catalog).includes('COHORT')).toBe(false)
    expect(JSON.stringify(catalog).includes('sk-test')).toBe(false)
    expect(existsSync(join(dirname(authPath), 'models.json'))).toBe(true)
  })

  it('maps provider errors to an opaque turn_failed detail', async () => {
    const { module } = fakeModule({
      prompt: async () => {
        throw new Error('sk-test 401 from https://api.x.ai/v1')
      }
    })
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => module
    })
    const result = await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })
    expect(result).toEqual({ kind: 'turn_failed', detail: 'turn failed' })
    expect(JSON.stringify(result).includes('sk-test')).toBe(false)
  })

  it('does not return ok from a partial stream when the final message errored', async () => {
    const fake = fakeModule({
      reply: 'partial from stream',
      assistant: {
        role: 'assistant',
        content: [{ type: 'text', text: 'partial from stream' }],
        stopReason: 'error',
        errorMessage: 'sk-test provider boom'
      }
    })
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    const result = await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })
    expect(result).toEqual({ kind: 'turn_failed', detail: 'turn failed' })
    expect(JSON.stringify(result).includes('sk-test')).toBe(false)
    expect(JSON.stringify(result).includes('partial from stream')).toBe(false)
    expect(fake.subscribed).toBe(0)
  })

  it('returns empty reply when the assistant has no text', async () => {
    const { module } = fakeModule({
      prompt: async () => undefined
    })
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => module
    })
    expect(await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'empty reply'
    })
  })

  it('aborts and disposes a session created after the deadline', async () => {
    let resume = (): void => undefined
    const held = new Promise<void>((resolve) => {
      resume = resolve
    })
    const fake = fakeModule({
      create: () => held
    })
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module,
      timeoutMs: 20
    })
    expect(await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
    expect(fake.opens).toBe(0)
    expect(fake.disposed).toBe(0)
    resume()
    await expect.poll(() => fake.disposed).toBe(1)
    expect(fake.opens).toBe(1)
    expect(fake.aborted).toBe(1)
  })

  it('returns stopped when the turn signal aborts', async () => {
    const fake = fakeModule({
      prompt: async () =>
        new Promise(() => {
          return
        })
    })
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    const abort = new AbortController()
    const pending = prime.turn({ prior: emptyPrior, ownerBody: 'hello', signal: abort.signal })
    await expect.poll(() => fake.opens).toBe(1)
    abort.abort()
    expect(await pending).toEqual({ kind: 'stopped' })
    expect(fake.aborted).toBe(1)
    expect(fake.disposed).toBe(0)
  })

  it('abort during a delayed endpoint writes no talk row', async () => {
    const home = tempHome()
    const roster = new RosterStore(home)
    roster.hatch('Scout')
    let release = (): void => undefined
    let started = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    let n = 0
    const fake = fakeModule({ reply: 'should not persist' })
    const talk = new TalkStore({
      home,
      known: (id) => roster.known(id),
      turn: primeTurn({
        bot: (id) => {
          const found = roster.bot(id)
          if (!found) throw new Error('unknown bot')
          return found
        },
        home,
        endpoint: async () => {
          started()
          await held
          return endpoint
        },
        load: async () => fake.module
      }).turn,
      id: () => `m${++n}`,
      now: () => 1
    })
    const assigned = talk.assign({ botId: 'scout', body: 'draft the outline' })
    await began
    expect(talk.interrupt('scout')).toEqual({ kind: 'ok' })
    release()
    expect(await assigned).toEqual({ kind: 'stopped' })
    expect(talk.thread('scout')).toEqual({ botId: 'scout', turns: [] })
    expect(fake.opens).toBe(0)
    talk.close()
    roster.close()
  })

  it('returns stopped without loading Prime when already aborted', async () => {
    let loaded = false
    const abort = new AbortController()
    abort.abort()
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => {
        loaded = true
        return fakeModule().module
      }
    })
    expect(await prime.turn({ prior: emptyPrior, ownerBody: 'hello', signal: abort.signal })).toEqual({
      kind: 'stopped'
    })
    expect(loaded).toBe(false)
  })

  it('returns timeout when the prompt hangs past the deadline', async () => {
    const fake = fakeModule({
      prompt: async () =>
        new Promise(() => {
          return
        })
    })
    const prime = primeTurn({
      bot: () => CHIEF,
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module,
      timeoutMs: 20
    })
    expect(await prime.turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
    expect(fake.disposed).toBe(1)
  })

  it.skipIf(!process.env.LIVE_PRIME)(
    'loads the real Prime SDK against a mock endpoint',
    { timeout: 60_000 },
    async () => {
      const home = tempHome()
      const server = createServer((req, res) => {
        if (req.method !== 'POST' || !req.url?.includes('chat/completions')) {
          res.statusCode = 404
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(
          'data: {"choices":[{"delta":{"content":"hi from Chief"},"finish_reason":null}]}\n\n'
        )
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      })
      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          resolve(typeof address === 'object' && address ? address.port : 0)
        })
      })
      try {
        const prime = primeTurn({
          bot: () => CHIEF,
          home,
          endpoint: async () => ({
            model: 'mock-hatch',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            key: 'sk-test'
          })
        })
        expect(
          await prime.turn({
            prior: emptyPrior,
            ownerBody: 'hello'
          })
        ).toEqual({ kind: 'ok', body: 'hi from Chief' })
        const catalog = JSON.parse(readFileSync(primeCatalogPath(home), 'utf8')) as {
          providers: { cohort: Record<string, unknown> }
        }
        expect(catalog.providers.cohort.apiKey).toBeUndefined()
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
    }
  )
})

describe('prime kernel contract', () => {
  it('keeps one live Turn and real Prime imports', () => {
    const main = readdirSync(new URL('.', import.meta.url))
    expect(main.includes('completions.ts')).toBe(false)
    const source = readFileSync(new URL('./prime.ts', import.meta.url), 'utf8')
    expect(source.includes('as unknown as PrimeModule')).toBe(false)
    expect(source.includes('mergeCohortAuth')).toBe(false)
    expect(source.includes("apiKey: 'COHORT'")).toBe(false)
    expect(source.includes("from 'prime-agent'")).toBe(true)
    expect(source.includes("tools: ['ipython']")).toBe(true)
    expect(source.includes("noTools: 'all'")).toBe(false)
    expect(source.includes('Object.assign')).toBe(false)
    expect(source.includes('roomTurn')).toBe(true)
    expect(source.includes('assistantText(session.messages)')).toBe(true)
    expect(source.includes('streamedText')).toBe(false)
    expect(source.includes('.subscribe(')).toBe(false)
  })
})
