import type { Endpoint } from './kernel'
import { HATCH_SYSTEM } from './hatch-prompt'
import type { Turn, TurnResult } from './turn'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCompletionsResponse(value: unknown): TurnResult {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    return { kind: 'turn_failed', detail: 'empty reply' }
  }
  const choice = value.choices[0]
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    return { kind: 'turn_failed', detail: 'empty reply' }
  }
  const content = choice.message.content.trim()
  if (content.length === 0) {
    return { kind: 'turn_failed', detail: 'empty reply' }
  }
  return { kind: 'ok', body: content }
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
      return { kind: 'needs_login' }
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
    try {
      const response = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${endpoint.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: endpoint.model, messages }),
        signal: controller.signal
      })
      if (!response.ok) {
        return { kind: 'turn_failed', detail: 'turn failed' }
      }
      return parseCompletionsResponse(await response.json())
    } catch (reason: unknown) {
      if (isAbort(reason)) {
        return { kind: 'turn_failed', detail: 'timeout' }
      }
      return { kind: 'turn_failed', detail: 'turn failed' }
    } finally {
      clearTimeout(timer)
    }
  }
}
