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
import { parseMessageId } from '../shared/talk'
import type { Endpoint } from './kernel'
import { assistantText, primeCatalogPath, primeTurn, type PrimeModule } from './prime'

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

const emptyPrior = { botId: 'hatch' as const, turns: [] }

function fakeModule(options?: {
  readonly reply?: string
  readonly prompt?: (text: string) => Promise<void>
}): {
  module: PrimeModule
  prompts: string[]
  seeded: unknown[]
  keys: string[]
  disposed: number
  opens: number
} {
  const prompts: string[] = []
  const seeded: unknown[] = []
  const keys: string[] = []
  let disposed = 0
  let opens = 0
  const reply = options?.reply ?? 'hi from Hatch'
  const module = {
    createAgentSession: async () => {
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
            messages.push({
              role: 'assistant',
              content: [{ type: 'text', text: reply }]
            })
          },
          subscribe: (listener: (event: { type: string; assistantMessageEvent?: { type: string; delta?: string } }) => void) => {
            if (!options?.prompt) {
              listener({
                type: 'message_update',
                assistantMessageEvent: { type: 'text_delta', delta: reply }
              })
            }
            return () => undefined
          },
          abort: async () => undefined,
          dispose: () => {
            disposed += 1
          }
        }
      }
    },
    ModelRuntime: {
      create: async () => ({
        getModels: () => [{ id: 'mock-hatch', provider: 'cohort' }],
        getModel: (_provider: string, id: string) =>
          id === 'mock-hatch' ? { id: 'mock-hatch', provider: 'cohort' } : undefined,
        setRuntimeApiKey: async (provider: string, key: string) => {
          keys.push(`${provider}:${key}`)
        }
      })
    },
    SessionManager: {
      inMemory: (cwd?: string) => ({ cwd })
    },
    DefaultResourceLoader: class {
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
    seeded,
    keys,
    get disposed() {
      return disposed
    },
    get opens() {
      return opens
    }
  }
}

describe('assistantText', () => {
  it('reads the last assistant text part', () => {
    expect(
      assistantText([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: [{ type: 'text', text: ' hi from Hatch ' }] }
      ])
    ).toBe('hi from Hatch')
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
    const { module, prompts, keys } = fakeModule()
    const turn = primeTurn({
      home,
      endpoint: async () => endpoint,
      load: async () => module
    })
    expect(
      await turn({
        prior: emptyPrior,
        ownerBody: 'hello'
      })
    ).toEqual({ kind: 'ok', body: 'hi from Hatch' })
    expect(prompts).toEqual(['hello'])
    expect(keys).toEqual(['cohort:sk-test'])
  })

  it('seeds prior turns into the session before the new prompt', async () => {
    const { module, prompts, seeded } = fakeModule()
    const turn = primeTurn({
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => module
    })
    await turn({
      prior: {
        botId: 'hatch',
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
    const turn = primeTurn({
      home: tempHome(),
      endpoint: async () => null,
      load: async () => {
        loaded = true
        return fakeModule().module
      }
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'needs_login'
    })
    expect(loaded).toBe(false)
  })

  it('opens a one-shot session and disposes it after each turn', async () => {
    const fake = fakeModule()
    const turn = primeTurn({
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module
    })
    await turn({ prior: emptyPrior, ownerBody: 'one' })
    await turn({ prior: emptyPrior, ownerBody: 'two' })
    expect(fake.prompts).toEqual(['one', 'two'])
    expect(fake.opens).toBe(2)
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
    const turn = primeTurn({
      home,
      endpoint: async () => endpoint,
      load: async () => module
    })
    await turn({ prior: emptyPrior, ownerBody: 'hello' })
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
    const turn = primeTurn({
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => module
    })
    const result = await turn({ prior: emptyPrior, ownerBody: 'hello' })
    expect(result).toEqual({ kind: 'turn_failed', detail: 'turn failed' })
    expect(JSON.stringify(result).includes('sk-test')).toBe(false)
  })

  it('returns empty reply when the assistant has no text', async () => {
    const { module } = fakeModule({
      prompt: async () => undefined
    })
    const turn = primeTurn({
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => module
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'empty reply'
    })
  })

  it('returns timeout when the prompt hangs past the deadline', async () => {
    const fake = fakeModule({
      prompt: async () =>
        new Promise(() => {
          return
        })
    })
    const turn = primeTurn({
      home: tempHome(),
      endpoint: async () => endpoint,
      load: async () => fake.module,
      timeoutMs: 20
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
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
          'data: {"choices":[{"delta":{"content":"hi from Hatch"},"finish_reason":null}]}\n\n'
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
        const turn = primeTurn({
          home,
          endpoint: async () => ({
            model: 'mock-hatch',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            key: 'sk-test'
          })
        })
        expect(
          await turn({
            prior: emptyPrior,
            ownerBody: 'hello'
          })
        ).toEqual({ kind: 'ok', body: 'hi from Hatch' })
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
    expect(source.includes("from '@earendil-works/pi-coding-agent'")).toBe(true)
  })
})
