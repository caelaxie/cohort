import { describe, expect, it } from 'vitest'
import { parseMessageId } from '../shared/talk'
import { completionsTurn } from './completions'
import type { Endpoint } from './kernel'

const endpoint: Endpoint = {
  model: 'llama3.1:8b',
  baseUrl: 'http://127.0.0.1:11434/v1',
  key: 'sk-test'
}

const emptyPrior = { botId: 'hatch' as const, turns: [] }

describe('completionsTurn', () => {
  it('posts chat completions and returns the assistant content', async () => {
    const seen: { url: string; auth: string | null; body: unknown }[] = []
    const turn = completionsTurn({
      endpoint: async () => endpoint,
      fetch: async (input, init) => {
        seen.push({
          url: String(input),
          auth: new Headers(init?.headers).get('Authorization'),
          body: JSON.parse(String(init?.body))
        })
        return new Response(
          JSON.stringify({ choices: [{ message: { content: ' hi from Hatch ' } }] }),
          { status: 200 }
        )
      }
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'ok',
      body: 'hi from Hatch'
    })
    expect(seen).toEqual([
      {
        url: 'http://127.0.0.1:11434/v1/chat/completions',
        auth: 'Bearer sk-test',
        body: {
          model: 'llama3.1:8b',
          messages: [
            {
              role: 'system',
              content:
                'You are Hatch, the lead bot in Cohort, a crew of named AI teammates on this Mac. Reply as a teammate. Do not claim to have tools or a computer.'
            },
            { role: 'user', content: 'hello' }
          ]
        }
      }
    ])
  })

  it('maps prior turns to user and assistant messages', async () => {
    const turn = completionsTurn({
      endpoint: async () => endpoint,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: { role: string; content: string }[]
        }
        expect(body.messages.slice(1)).toEqual([
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'a' },
          { role: 'user', content: 'two' }
        ])
        return new Response(JSON.stringify({ choices: [{ message: { content: 'b' } }] }))
      }
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
  })

  it('returns needs_login and does not fetch when endpoint is null', async () => {
    let fetched = false
    const turn = completionsTurn({
      endpoint: async () => null,
      fetch: async () => {
        fetched = true
        return new Response('nope')
      }
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({ kind: 'needs_login' })
    expect(fetched).toBe(false)
  })

  it('returns turn_failed on HTTP 500 without the key', async () => {
    const turn = completionsTurn({
      endpoint: async () => endpoint,
      fetch: async () => new Response('nope', { status: 500 })
    })
    const result = await turn({ prior: emptyPrior, ownerBody: 'hello' })
    expect(result).toEqual({ kind: 'turn_failed', detail: 'turn failed' })
    expect(JSON.stringify(result).includes('sk-test')).toBe(false)
  })

  it('returns empty reply when content is missing', async () => {
    const turn = completionsTurn({
      endpoint: async () => endpoint,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: {} }] }))
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'empty reply'
    })
  })

  it('returns timeout when the request is aborted', async () => {
    const turn = completionsTurn({
      endpoint: async () => endpoint,
      timeoutMs: 20,
      fetch: async (_input, init) => {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
        return new Response('nope')
      }
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
  })

  it('returns timeout when the body read is aborted', async () => {
    const turn = completionsTurn({
      endpoint: async () => endpoint,
      timeoutMs: 20,
      fetch: async (_input, init) =>
        ({
          ok: true,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                const error = new Error('aborted')
                error.name = 'AbortError'
                reject(error)
              })
            })
        }) as Response
    })
    expect(await turn({ prior: emptyPrior, ownerBody: 'hello' })).toEqual({
      kind: 'turn_failed',
      detail: 'timeout'
    })
  })
})
