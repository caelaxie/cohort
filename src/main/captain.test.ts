import { describe, expect, it } from 'vitest'
import {
  PrimeSdkError,
  createPrimeSessionFactory,
  promptForReply,
  type PrimeSession,
  type PrimeSessionEvent
} from './captain'

type RecordedSession = {
  session: PrimeSession
  prompts: string[]
  events: PrimeSessionEvent[]
  disposed: boolean
  unsubscribed: boolean
}

function fakeSession(replies: string[], events: PrimeSessionEvent[]): RecordedSession {
  const recorded: RecordedSession = {
    prompts: [],
    events,
    disposed: false,
    unsubscribed: false,
    session: null as unknown as PrimeSession
  }
  recorded.session = {
    prompt: async (text: string) => {
      recorded.prompts.push(text)
      for (const event of events) {
        for (const listener of listeners) listener(event)
      }
      void replies
    },
    subscribe: (listener) => {
      listeners.push(listener)
      return () => {
        recorded.unsubscribed = true
      }
    },
    dispose: () => {
      recorded.disposed = true
    }
  }
  const listeners: Array<(event: PrimeSessionEvent) => void> = []
  return recorded
}

describe('captain spike', () => {
  it('collects the assistant reply from session events', async () => {
    const events: PrimeSessionEvent[] = [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hi ' } },
      { type: 'message_end' },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'there' } }
    ]
    const recorded = fakeSession([], events)
    const reply = await promptForReply(async () => recorded.session, '/tmp/spike-cwd', 'hello')
    expect(reply).toBe('Hi there')
    expect(recorded.prompts).toEqual(['hello'])
    expect(recorded.disposed).toBe(true)
    expect(recorded.unsubscribed).toBe(true)
  })

  it('surfaces a typed error when the SDK module cannot be loaded', async () => {
    const factory = createPrimeSessionFactory(async () => {
      throw new Error("Cannot find module '@earendil-works/pi-coding-agent'")
    })
    await expect(factory({ cwd: '/tmp/spike-cwd' })).rejects.toBeInstanceOf(PrimeSdkError)
  })

  it(
    'loads the real SDK and creates an in-process session',
    { skip: process.env.COHORT_PRIME_SPIKE !== '1' },
    async () => {
      const factory = createPrimeSessionFactory()
      const session = await factory({ cwd: '/tmp/cohort-prime-spike' })
      expect(typeof session.prompt).toBe('function')
      session.dispose()
    }
  )
})
