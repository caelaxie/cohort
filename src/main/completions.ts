import type { Thread } from '../shared/talk'
import type { Endpoint } from './kernel'

export type Turn = (input: {
  readonly prior: Thread
  readonly ownerBody: string
}) => Promise<string>

const HATCH_SYSTEM =
  'You are Hatch, the lead bot in Cohort, a crew of named AI teammates on this Mac. Reply as a teammate. Do not claim to have tools or a computer.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCompletionsResponse(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    throw new Error('empty reply')
  }
  const choice = value.choices[0]
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    throw new Error('empty reply')
  }
  const content = choice.message.content.trim()
  if (content.length === 0) {
    throw new Error('empty reply')
  }
  return content
}

function isAbort(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    reason.name === 'AbortError'
  )
}

export function completionsTurn(options: {
  readonly endpoint: () => Promise<Endpoint | null>
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}): Turn {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 60_000

  return async (input) => {
    const endpoint = await options.endpoint()
    if (endpoint === null) {
      throw new Error('needs_login')
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: HATCH_SYSTEM }
    ]
    for (const turn of input.prior.turns) {
      messages.push({ role: 'user', content: turn.owner.body })
      messages.push({ role: 'assistant', content: turn.bot.body })
    }
    messages.push({ role: 'user', content: input.ownerBody })

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${endpoint.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: endpoint.model, messages }),
        signal: controller.signal
      })
    } catch (reason: unknown) {
      if (isAbort(reason)) {
        throw new Error('timeout')
      }
      throw new Error('turn failed')
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error('turn failed')
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      throw new Error('turn failed')
    }
    return parseCompletionsResponse(parsed)
  }
}
