import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  parseConnectMethodId,
  parseKernelStatus,
  readyForTalk as statusReadyForTalk,
  type ConnectMethod,
  type KernelStatus
} from '../shared/kernel'

export type KernelOptions = {
  readonly env: NodeJS.Dict<string>
  readonly primeAuthPath: string
}

const COMPLETIONS_RECORD = 'openai-completions'

type Shortcut = {
  readonly id: 'xai' | 'openai'
  readonly env: string
  readonly model: string
  readonly baseUrl: string
}

const SHORTCUTS: readonly Shortcut[] = [
  { id: 'xai', env: 'XAI_API_KEY', model: 'grok-4.5', baseUrl: 'https://api.x.ai/v1' },
  { id: 'openai', env: 'OPENAI_API_KEY', model: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' }
]

type ConnectRequest =
  | { readonly kind: 'probe' }
  | {
      readonly kind: 'paste'
      readonly baseUrl: string
      readonly model: string
      readonly secret: string
    }

type AuthFile =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'parsed'; readonly records: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(reason: unknown): boolean {
  return (
    typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'ENOENT'
  )
}

function connectMethods(): readonly ConnectMethod[] {
  return [
    {
      id: parseConnectMethodId('probe'),
      label: 'Use a key already on this Mac',
      kind: 'probe'
    }
  ]
}

function parseBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('invalid base url')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('invalid base url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('invalid base url')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('invalid base url')
  }
  return url.href.replace(/\/+$/, '')
}

function parseConnectRequest(input: unknown): ConnectRequest {
  if (input === undefined || input === null) {
    return { kind: 'probe' }
  }
  if (!isRecord(input)) {
    throw new Error('invalid connect')
  }
  if (input.kind === 'probe') {
    return { kind: 'probe' }
  }
  if (input.kind !== 'paste') {
    throw new Error('invalid connect')
  }
  if (typeof input.secret !== 'string' || input.secret.trim().length === 0) {
    throw new Error('empty secret')
  }
  if (typeof input.model !== 'string' || input.model.trim().length === 0) {
    throw new Error('empty model')
  }
  return {
    kind: 'paste',
    baseUrl: parseBaseUrl(input.baseUrl),
    model: input.model.trim(),
    secret: input.secret.trim()
  }
}

function envPresent(env: NodeJS.Dict<string>, name: string): boolean {
  const value = env[name]
  return typeof value === 'string' && value.trim().length > 0
}

function filePresent(records: Record<string, unknown>, providerId: string): boolean {
  const entry = records[providerId]
  if (!isRecord(entry) || entry.type !== 'api_key' || typeof entry.key !== 'string') {
    return false
  }
  return entry.key.trim().length > 0
}

function completionsRecord(
  value: unknown
): { readonly model: string; readonly baseUrl: string } | null {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.trim().length === 0) {
    return null
  }
  if (typeof value.model !== 'string' || value.model.trim().length === 0) {
    return null
  }
  try {
    return { model: value.model.trim(), baseUrl: parseBaseUrl(value.baseUrl) }
  } catch {
    return null
  }
}

export class Kernel {
  private readonly env: NodeJS.Dict<string>
  private readonly primeAuthPath: string
  private startGate: Promise<KernelStatus> | null = null
  private current: KernelStatus | undefined

  constructor(options: KernelOptions) {
    this.env = options.env
    this.primeAuthPath = options.primeAuthPath
  }

  start(): Promise<KernelStatus> {
    if (this.startGate) {
      return this.startGate
    }
    this.startGate = this.probe().then((status) => {
      this.current = status
      return status
    })
    return this.startGate
  }

  async stop(): Promise<void> {
    if (this.startGate) {
      await this.startGate.catch(() => undefined)
    }
    this.startGate = null
    this.current = undefined
  }

  status(): KernelStatus {
    if (this.current === undefined) {
      throw new Error('kernel not started')
    }
    return this.current
  }

  readyForTalk(): boolean {
    return statusReadyForTalk(this.status())
  }

  async connect(input?: unknown): Promise<KernelStatus> {
    if (this.startGate) {
      await this.startGate.catch(() => {
        this.startGate = null
      })
    }
    const request = parseConnectRequest(input)
    const status = request.kind === 'probe' ? await this.probe() : await this.paste(request)
    this.current = status
    this.startGate = Promise.resolve(status)
    return status
  }

  private async paste(request: Extract<ConnectRequest, { kind: 'paste' }>): Promise<KernelStatus> {
    const file = await this.readAuth()
    if (file.kind === 'unreadable') {
      throw new Error('auth file unreadable')
    }
    const records = file.kind === 'parsed' ? { ...file.records } : {}
    records[COMPLETIONS_RECORD] = {
      type: 'api_key',
      key: request.secret,
      baseUrl: request.baseUrl,
      model: request.model
    }
    await mkdir(dirname(this.primeAuthPath), { recursive: true })
    await writeFile(this.primeAuthPath, `${JSON.stringify(records, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await chmod(this.primeAuthPath, 0o600)
    return this.probe()
  }

  private async probe(): Promise<KernelStatus> {
    const file = await this.readAuth()
    const records = file.kind === 'parsed' ? file.records : {}
    const methods = connectMethods()
    const custom = completionsRecord(records[COMPLETIONS_RECORD])
    if (custom) {
      return parseKernelStatus({
        kind: 'ready',
        model: custom.model,
        baseUrl: custom.baseUrl,
        methods
      })
    }
    for (const shortcut of SHORTCUTS) {
      const fromFile = file.kind === 'parsed' && filePresent(records, shortcut.id)
      const fromEnv = envPresent(this.env, shortcut.env)
      if (fromFile || fromEnv) {
        return parseKernelStatus({
          kind: 'ready',
          model: shortcut.model,
          baseUrl: shortcut.baseUrl,
          methods
        })
      }
    }
    return parseKernelStatus({ kind: 'needs_login', methods })
  }

  private async readAuth(): Promise<AuthFile> {
    let raw: string
    try {
      raw = await readFile(this.primeAuthPath, 'utf8')
    } catch (reason) {
      if (isNotFound(reason)) {
        return { kind: 'missing' }
      }
      return { kind: 'unreadable' }
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed)) {
        return { kind: 'unreadable' }
      }
      return { kind: 'parsed', records: parsed }
    } catch {
      return { kind: 'unreadable' }
    }
  }
}
