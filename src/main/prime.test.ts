import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Endpoint } from './kernel'
import { assistantText, primeTurn, type PrimeModule } from './prime'

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

function fakeModule(reply = 'hi from Hatch'): {
  module: PrimeModule
  prompts: string[]
  sessionOptions: unknown[]
} {
  const prompts: string[] = []
  const sessionOptions: unknown[] = []
  const messages: unknown[] = []
  const module: PrimeModule = {
    createAgentSession: async (options) => {
      sessionOptions.push(options)
      return {
        session: {
          messages,
          prompt: async (text) => {
            prompts.push(text)
            messages.push({
              role: 'assistant',
              content: [{ type: 'text', text: reply }]
            })
          },
          subscribe: (listener) => {
            listener({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: reply }
            })
            return () => undefined
          },
          dispose: () => undefined
        }
      }
    },
    ModelRuntime: {
      create: async () => ({
        getModels: () => [{ id: 'mock-hatch', provider: 'cohort' }],
        getModel: (_provider, id) =>
          id === 'mock-hatch' ? { id: 'mock-hatch', provider: 'cohort' } : undefined
      })
    },
    SessionManager: {
      inMemory: (cwd) => ({ cwd })
    },
    DefaultResourceLoader: class {
      async reload(): Promise<void> {
        return
      }
    } as PrimeModule['DefaultResourceLoader'],
    SettingsManager: {
      inMemory: (settings) => settings
    }
  }
  return { module, prompts, sessionOptions }
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
})

describe('primeTurn', () => {
  it('prompts Prime and returns the assistant reply', async () => {
    const home = tempHome()
    const { module, prompts } = fakeModule()
    const turn = primeTurn({
      home,
      primeAuthPath: join(home, 'prime', 'agent', 'auth.json'),
      endpoint: async () => endpoint,
      load: async () => module
    })
    expect(
      await turn({
        prior: { botId: 'hatch', turns: [] },
        ownerBody: 'hello'
      })
    ).toEqual({ kind: 'ok', body: 'hi from Hatch' })
    expect(prompts).toEqual(['hello'])
  })

  it('returns needs_login and does not load Prime', async () => {
    let loaded = false
    const turn = primeTurn({
      home: tempHome(),
      primeAuthPath: join(tempHome(), 'auth.json'),
      endpoint: async () => null,
      load: async () => {
        loaded = true
        return fakeModule().module
      }
    })
    expect(await turn({ prior: { botId: 'hatch', turns: [] }, ownerBody: 'hello' })).toEqual({
      kind: 'needs_login'
    })
    expect(loaded).toBe(false)
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
          primeAuthPath: join(home, 'prime', 'agent', 'auth.json'),
          endpoint: async () => ({
            model: 'mock-hatch',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            key: 'sk-test'
          })
        })
        expect(
          await turn({
            prior: { botId: 'hatch', turns: [] },
            ownerBody: 'hello'
          })
        ).toEqual({ kind: 'ok', body: 'hi from Hatch' })
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
    }
  )

  it('reuses the session for a second prompt on the same bot', async () => {
    const home = tempHome()
    const { module, prompts, sessionOptions } = fakeModule()
    const turn = primeTurn({
      home,
      primeAuthPath: join(home, 'prime', 'agent', 'auth.json'),
      endpoint: async () => endpoint,
      load: async () => module
    })
    const prior = { botId: 'hatch' as const, turns: [] }
    await turn({ prior, ownerBody: 'one' })
    await turn({ prior, ownerBody: 'two' })
    expect(prompts).toEqual(['one', 'two'])
    expect(sessionOptions).toHaveLength(1)
  })
})
