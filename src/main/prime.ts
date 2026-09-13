import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentSession } from 'prime-agent'
import type { Bot, BotId } from '../shared/roster'
import type { Thread } from '../shared/talk'
import { botSystemPrompt } from './chief-prompt'
import type { Endpoint } from './kernel'
import { primeWorkDir } from './paths'
import type { Turn, TurnResult } from './turn'

type PrimeMessage = AgentSession['messages'][number]

export type PrimeModule = typeof import('prime-agent')

type LiveSession = {
  readonly fingerprint: string
  readonly session: AgentSession
}

const TURN_MS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbort(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    reason.name === 'AbortError'
  )
}

function timeoutError(): Error {
  const error = new Error('timeout')
  error.name = 'AbortError'
  return error
}

function stoppedError(): Error {
  const error = new Error('stopped')
  error.name = 'AbortError'
  return error
}

function failed(reason: unknown, stopped: boolean): TurnResult {
  if (stopped) {
    return { kind: 'stopped' }
  }
  if (isAbort(reason)) {
    return { kind: 'turn_failed', detail: 'timeout' }
  }
  if (reason instanceof Error && reason.message === 'empty reply') {
    return { kind: 'turn_failed', detail: 'empty reply' }
  }
  return { kind: 'turn_failed', detail: 'turn failed' }
}

export function assistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!isRecord(message)) continue
    const role = message.role ?? message.type
    if (role !== 'assistant') continue
    if (message.stopReason === 'error') {
      throw new Error('turn failed')
    }
    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return message.content.trim()
    }
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (typeof part === 'string') return part
          if (isRecord(part) && typeof part.text === 'string') return part.text
          return ''
        })
        .join('')
        .trim()
      if (text.length > 0) return text
    }
    if (typeof message.text === 'string' && message.text.trim().length > 0) {
      return message.text.trim()
    }
  }
  throw new Error('empty reply')
}

function priorMessages(prior: Thread, model: string): PrimeMessage[] {
  const messages: PrimeMessage[] = []
  for (const turn of prior.turns) {
    messages.push({
      role: 'user',
      content: turn.owner.body,
      timestamp: turn.owner.createdAt
    })
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: turn.bot.body }],
      api: 'openai-completions',
      provider: 'cohort',
      model,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: turn.bot.createdAt
    })
  }
  return messages
}

async function writeCatalog(modelsPath: string, endpoint: Endpoint): Promise<void> {
  const models = {
    providers: {
      cohort: {
        baseUrl: endpoint.baseUrl,
        api: 'openai-completions',
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false
        },
        models: [{ id: endpoint.model }]
      }
    }
  }
  await mkdir(dirname(modelsPath), { recursive: true })
  await writeFile(modelsPath, `${JSON.stringify(models, null, 2)}\n`, 'utf8')
}

const defaultLoad = (): Promise<PrimeModule> => import('prime-agent')

export function primeCatalogPath(home: string): string {
  return join(home, 'prime', 'agent', 'models.json')
}

export type PrimeKernel = {
  readonly turn: Turn
  readonly roomTurn: Turn
  close(): void
}

export function primeTurn(options: {
  readonly endpoint: () => Promise<Endpoint | null>
  readonly home: string
  readonly bot: (id: BotId) => Bot
  readonly load?: () => Promise<PrimeModule>
  readonly timeoutMs?: number
}): PrimeKernel {
  const load = options.load ?? defaultLoad
  const timeoutMs = options.timeoutMs ?? TURN_MS
  const live = new Map<string, LiveSession>()

  const drop = (slot: string): void => {
    const item = live.get(slot)
    if (item === undefined) return
    item.session.dispose()
    live.delete(slot)
  }

  const close = (): void => {
    for (const slot of [...live.keys()]) drop(slot)
  }

  const bind = (channel: 'dm' | 'room'): Turn => {
    return async (input) => {
      const slot = `${channel}:${input.prior.botId}`
      let session: AgentSession | undefined
      let timedOut = false
      let stopped = false
      let rejectDeadline: ((reason: Error) => void) | undefined
      const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = reject
      })
      const onAbort = (): void => {
        stopped = true
        void session?.abort()
        rejectDeadline?.(stoppedError())
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      if (input.signal?.aborted) {
        input.signal.removeEventListener('abort', onAbort)
        return { kind: 'stopped' }
      }

      const timer = setTimeout(() => {
        timedOut = true
        void session?.abort()
        rejectDeadline?.(timeoutError())
      }, timeoutMs)

      let opened: Promise<TurnResult> | undefined
      try {
        const ready = await Promise.race([options.endpoint(), deadline])
        if (stopped || input.signal?.aborted) {
          return { kind: 'stopped' }
        }
        if (ready === null) {
          return { kind: 'needs_login' }
        }
        opened = openTurn(ready)
        const result = await Promise.race([opened, deadline])
        if (stopped || input.signal?.aborted) {
          return { kind: 'stopped' }
        }
        return result
      } catch (reason: unknown) {
        if (timedOut && session !== undefined) {
          drop(slot)
          session = undefined
        }
        return failed(reason, stopped || input.signal?.aborted === true)
      } finally {
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', onAbort)
        void opened?.catch(() => undefined)
      }

      async function openTurn(endpoint: Endpoint): Promise<TurnResult> {
        const fingerprint = `${endpoint.baseUrl}\n${endpoint.model}`
        const existing = live.get(slot)
        if (existing !== undefined && existing.fingerprint !== fingerprint) {
          drop(slot)
        }
        const hit = live.get(slot)
        if (hit !== undefined) {
          session = hit.session
          await session.prompt(input.ownerBody)
          return { kind: 'ok', body: assistantText(session.messages) }
        }
        const created = await createSession(endpoint)
        session = created
        if (timedOut || stopped) {
          void session.abort()
          session.dispose()
          session = undefined
          throw stopped ? stoppedError() : timeoutError()
        }
        live.set(slot, { fingerprint, session })
        if (input.prior.turns.length > 0) {
          session.agent.state.messages = priorMessages(input.prior, endpoint.model)
        }
        await session.prompt(input.ownerBody)
        return { kind: 'ok', body: assistantText(session.messages) }
      }

      async function createSession(endpoint: Endpoint): Promise<AgentSession> {
        const module = await load()
        const cwd = primeWorkDir(options.home, input.prior.botId)
        const agentDir = dirname(primeCatalogPath(options.home))
        const modelsPath = primeCatalogPath(options.home)
        await mkdir(cwd, { recursive: true })
        await writeCatalog(modelsPath, endpoint)
        const authStorage = module.AuthStorage.create(join(agentDir, 'runtime-auth.json'))
        authStorage.setRuntimeApiKey('cohort', endpoint.key)
        const modelRegistry = module.ModelRegistry.create(authStorage, modelsPath)
        modelRegistry.registerProvider('cohort', {
          baseUrl: endpoint.baseUrl,
          api: 'openai-completions',
          apiKey: endpoint.key,
          models: [
            {
              id: endpoint.model,
              name: endpoint.model,
              reasoning: true,
              input: ['text'],
              contextWindow: 128_000,
              maxTokens: 8192,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            }
          ]
        })
        const model =
          modelRegistry.find('cohort', endpoint.model) ??
          modelRegistry.getAll().find((item) => item.id === endpoint.model)
        if (model === undefined) {
          throw new Error('turn failed')
        }
        const settingsManager = module.SettingsManager.inMemory({
          compaction: { enabled: false }
        })
        const resourceLoader = new module.DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPrompt: botSystemPrompt(options.bot(input.prior.botId))
        })
        await resourceLoader.reload()
        const created = await module.createAgentSession({
          cwd,
          agentDir,
          authStorage,
          modelRegistry,
          model,
          thinkingLevel: 'minimal',
          tools: ['ipython'],
          includeGoals: false,
          resourceLoader,
          sessionManager: module.SessionManager.inMemory(cwd),
          settingsManager
        })
        return created.session
      }
    }
  }

  return { turn: bind('dm'), roomTurn: bind('room'), close }
}
