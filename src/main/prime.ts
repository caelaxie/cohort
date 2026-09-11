import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { Endpoint } from './kernel'
import { HATCH_SYSTEM } from './hatch-prompt'
import { primeWorkDir } from './paths'
import type { Thread } from '../shared/talk'
import type { Turn, TurnResult } from './turn'

type PrimeMessage = AgentSession['messages'][number]

export type PrimeModule = typeof import('@earendil-works/pi-coding-agent')

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

function failed(reason: unknown): TurnResult {
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

const defaultLoad = (): Promise<PrimeModule> => import('@earendil-works/pi-coding-agent')

export function primeCatalogPath(home: string): string {
  return join(home, 'prime', 'agent', 'models.json')
}

export function primeTurn(options: {
  readonly endpoint: () => Promise<Endpoint | null>
  readonly home: string
  readonly load?: () => Promise<PrimeModule>
  readonly timeoutMs?: number
}): Turn {
  const load = options.load ?? defaultLoad
  const timeoutMs = options.timeoutMs ?? TURN_MS

  return async (input) => {
    const ready = await options.endpoint()
    if (ready === null) {
      return { kind: 'needs_login' }
    }

    let session: AgentSession | undefined
    let timedOut = false
    let rejectDeadline: ((reason: Error) => void) | undefined
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject
    })
    const timer = setTimeout(() => {
      timedOut = true
      void session?.abort()
      rejectDeadline?.(timeoutError())
    }, timeoutMs)

    const opened = openTurn(ready)
    try {
      return await Promise.race([opened, deadline])
    } catch (reason: unknown) {
      return failed(reason)
    } finally {
      clearTimeout(timer)
      session?.dispose()
      void opened.catch(() => undefined)
    }

    async function openTurn(endpoint: Endpoint): Promise<TurnResult> {
      const module = await load()
      const cwd = primeWorkDir(options.home, input.prior.botId)
      const agentDir = dirname(primeCatalogPath(options.home))
      const modelsPath = primeCatalogPath(options.home)
      await mkdir(cwd, { recursive: true })
      await writeCatalog(modelsPath, endpoint)
      const modelRuntime = await module.ModelRuntime.create({
        authPath: join(agentDir, 'runtime-auth.json'),
        modelsPath,
        refreshOnCreate: false,
        allowModelNetwork: false
      })
      await modelRuntime.setRuntimeApiKey('cohort', endpoint.key)
      const model =
        modelRuntime.getModel('cohort', endpoint.model) ??
        modelRuntime.getModels().find((item) => item.id === endpoint.model)
      if (model === undefined) {
        return { kind: 'turn_failed', detail: 'turn failed' }
      }
      const settingsManager = module.SettingsManager.inMemory({
        compaction: { enabled: false },
        defaultTools: []
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
        systemPrompt: HATCH_SYSTEM
      })
      await resourceLoader.reload()
      const created = await module.createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        model,
        thinkingLevel: 'minimal',
        noTools: 'all',
        resourceLoader,
        sessionManager: module.SessionManager.inMemory(cwd),
        settingsManager
      })
      session = created.session
      if (timedOut) {
        void session.abort()
        session.dispose()
        session = undefined
        throw timeoutError()
      }
      if (input.prior.turns.length > 0) {
        session.agent.state.messages = priorMessages(input.prior, endpoint.model)
      }
      await session.prompt(input.ownerBody)
      return { kind: 'ok', body: assistantText(session.messages) }
    }
  }
}
