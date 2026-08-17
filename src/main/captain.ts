import type { AgentSession } from '@earendil-works/pi-coding-agent'

export type PrimeSessionEvent = {
  type: string
  assistantMessageEvent?: { type?: string; delta?: string }
  [key: string]: unknown
}

export type PrimeSession = {
  prompt: (text: string) => Promise<void>
  subscribe: (listener: (event: PrimeSessionEvent) => void) => () => void
  dispose: () => void
}

export type PrimeSessionFactory = (input: { cwd: string }) => Promise<PrimeSession>

// Minimal structural view of the SDK namespace. The real module is only
// loaded at runtime through the injectable loader below.
type PrimeModule = {
  createAgentSession: (options: {
    cwd: string
    sessionManager: object
  }) => Promise<{ session: AgentSession }>
  SessionManager: { inMemory: () => object }
}

type PrimeModuleLoader = () => Promise<PrimeModule>

export class PrimeSdkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PrimeSdkError'
  }
}

// Lazy import: the SDK must stay external to the main bundle and load on
// first use, mirroring the established `live-box.ts` native-module pattern.
const loadPrimeModule: PrimeModuleLoader = async () =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PrimeModule

/**
 * Builds a Prime session factory with a lazy in-process SDK import.
 * U1 spike shape: one session, in-memory history, no CLI child process.
 */
export function createPrimeSessionFactory(load: PrimeModuleLoader = loadPrimeModule): PrimeSessionFactory {
  return async ({ cwd }) => {
    let sdk: PrimeModule
    try {
      sdk = await load()
    } catch (cause) {
      throw new PrimeSdkError('Prime SDK failed to load in the main process', { cause })
    }
    try {
      const { session } = await sdk.createAgentSession({
        cwd,
        sessionManager: sdk.SessionManager.inMemory()
      })
      return session as unknown as PrimeSession
    } catch (cause) {
      throw new PrimeSdkError('Prime session could not be created', { cause })
    }
  }
}

function textDelta(event: PrimeSessionEvent): string | null {
  const message = event.assistantMessageEvent
  if (event.type !== 'message_update' || !message) return null
  if (message.type !== 'text_delta' || typeof message.delta !== 'string') return null
  return message.delta
}

export async function promptForReply(
  factory: PrimeSessionFactory,
  cwd: string,
  text: string
): Promise<string> {
  const session = await factory({ cwd })
  let reply = ''
  const unsubscribe = session.subscribe((event) => {
    const delta = textDelta(event)
    if (delta !== null) reply += delta
  })
  try {
    await session.prompt(text)
  } finally {
    unsubscribe()
    session.dispose()
  }
  return reply
}
