import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chmod } from 'node:fs/promises'
import type { Endpoint } from './kernel'
import { HATCH_SYSTEM } from './hatch-prompt'
import { primeWorkDir } from './paths'
import type { Turn, TurnResult } from './turn'

type PrimeSessionEvent = {
  readonly type?: string
  readonly assistantMessageEvent?: { readonly type?: string; readonly delta?: string }
}

type PrimeSession = {
  readonly messages: unknown[]
  prompt: (text: string) => Promise<void>
  subscribe?: (listener: (event: PrimeSessionEvent) => void) => () => void
  dispose: () => void
}

export type PrimeModule = {
  createAgentSession: (options: unknown) => Promise<{ session: PrimeSession }>
  ModelRuntime: {
    create: (options: {
      authPath: string
      modelsPath: string
      refreshOnCreate?: boolean
      allowModelNetwork?: boolean
    }) => Promise<{
      getModels: () => readonly { readonly id: string; readonly provider?: string }[]
      getModel: (
        providerId: string,
        modelId: string
      ) => { readonly id: string; readonly provider?: string } | undefined
    }>
  }
  SessionManager: {
    inMemory: (cwd: string) => unknown
  }
  DefaultResourceLoader: new (options: {
    cwd: string
    agentDir: string
    settingsManager: unknown
    noExtensions?: boolean
    noSkills?: boolean
    noPromptTemplates?: boolean
    noThemes?: boolean
    noContextFiles?: boolean
    systemPrompt?: string
  }) => { reload: () => Promise<void> }
  SettingsManager: {
    inMemory: (settings?: unknown) => unknown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failed(reason: unknown): TurnResult {
  return {
    kind: 'turn_failed',
    detail: reason instanceof Error && reason.message.length > 0 ? reason.message : 'turn failed'
  }
}

export function assistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!isRecord(message)) continue
    const role = message.role ?? message.type
    if (role !== 'assistant') continue
    if (message.stopReason === 'error') {
      throw new Error(
        typeof message.errorMessage === 'string' && message.errorMessage.length > 0
          ? message.errorMessage
          : 'turn failed'
      )
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

async function mergeCohortAuth(authPath: string, key: string): Promise<void> {
  let records: Record<string, unknown> = {}
  try {
    const raw = await readFile(authPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed)) records = parsed
  } catch {
    records = {}
  }
  records.cohort = { type: 'api_key', key }
  await mkdir(dirname(authPath), { recursive: true })
  await writeFile(authPath, `${JSON.stringify(records, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await chmod(authPath, 0o600)
}

async function writeModels(modelsPath: string, endpoint: Endpoint): Promise<void> {
  const models = {
    providers: {
      cohort: {
        baseUrl: endpoint.baseUrl,
        api: 'openai-completions',
        apiKey: 'COHORT',
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

const defaultLoad = async (): Promise<PrimeModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PrimeModule

export function primeTurn(options: {
  readonly endpoint: () => Promise<Endpoint | null>
  readonly primeAuthPath: string
  readonly home: string
  readonly load?: () => Promise<PrimeModule>
}): Turn {
  const load = options.load ?? defaultLoad
  const sessions = new Map<string, Promise<PrimeSession>>()

  async function openSession(botId: string, endpoint: Endpoint): Promise<PrimeSession> {
    const module = await load()
    const cwd = primeWorkDir(options.home, botId)
    await mkdir(cwd, { recursive: true })
    const modelsPath = join(dirname(options.primeAuthPath), 'models.json')
    await writeModels(modelsPath, endpoint)
    await mergeCohortAuth(options.primeAuthPath, endpoint.key)
    const modelRuntime = await module.ModelRuntime.create({
      authPath: options.primeAuthPath,
      modelsPath,
      refreshOnCreate: false,
      allowModelNetwork: false
    })
    const model =
      modelRuntime.getModel('cohort', endpoint.model) ??
      modelRuntime.getModels().find((item) => item.id === endpoint.model)
    if (model === undefined) {
      throw new Error('turn failed')
    }
    const settingsManager = module.SettingsManager.inMemory({
      compaction: { enabled: false },
      defaultTools: []
    })
    const resourceLoader = new module.DefaultResourceLoader({
      cwd,
      agentDir: dirname(options.primeAuthPath),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: HATCH_SYSTEM
    })
    await resourceLoader.reload()
    const { session } = await module.createAgentSession({
      cwd,
      agentDir: dirname(options.primeAuthPath),
      modelRuntime,
      model,
      thinkingLevel: 'minimal',
      noTools: 'all',
      tools: [],
      resourceLoader,
      sessionManager: module.SessionManager.inMemory(cwd),
      settingsManager
    })
    return session
  }

  return async (input) => {
    const endpoint = await options.endpoint()
    if (endpoint === null) {
      return { kind: 'needs_login' }
    }
    const botId = input.prior.botId
    let pending = sessions.get(botId)
    if (pending === undefined) {
      pending = openSession(botId, endpoint)
      sessions.set(botId, pending)
    }
    let session: PrimeSession
    try {
      session = await pending
    } catch (reason: unknown) {
      sessions.delete(botId)
      return failed(reason)
    }
    let streamed = ''
    const unsubscribe = session.subscribe?.((event) => {
      const delta = event.assistantMessageEvent
      if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
        streamed += delta.delta
      }
    })
    try {
      await session.prompt(input.ownerBody)
    } catch (reason: unknown) {
      return failed(reason)
    } finally {
      unsubscribe?.()
    }
    if (streamed.trim().length > 0) {
      return { kind: 'ok', body: streamed.trim() }
    }
    try {
      return { kind: 'ok', body: assistantText(session.messages) }
    } catch (reason: unknown) {
      return failed(reason)
    }
  }
}
