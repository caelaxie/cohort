import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  parseConnectMethodId,
  parseKernelStatus,
  readyForTalk as statusReadyForTalk,
  type ConnectMethod,
  type ConnectMethodId,
  type KernelStatus
} from '../shared/kernel'

export type KernelOptions = {
  readonly env: NodeJS.Dict<string>
  readonly primeAuthPath: string
}

type Provider = {
  readonly id: 'xai' | 'openai' | 'anthropic'
  readonly env: string
  readonly model: string
  readonly label: string
}

const PROVIDERS: readonly Provider[] = [
  { id: 'xai', env: 'XAI_API_KEY', model: 'grok-4.5', label: 'xAI' },
  { id: 'openai', env: 'OPENAI_API_KEY', model: 'gpt-4.1', label: 'OpenAI' },
  { id: 'anthropic', env: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5', label: 'Anthropic' }
]

type ConnectRequest =
  | { readonly kind: 'probe' }
  | { readonly kind: 'paste'; readonly id: ConnectMethodId; readonly secret: string }

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

function pasteMethod(provider: Provider): ConnectMethod {
  return {
    id: parseConnectMethodId(provider.id),
    label: provider.label,
    kind: 'paste'
  }
}

function connectMethods(): readonly ConnectMethod[] {
  return [
    {
      id: parseConnectMethodId('probe'),
      label: 'Use a key already on this Mac',
      kind: 'probe'
    },
    ...PROVIDERS.map(pasteMethod)
  ]
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
  const id = parseConnectMethodId(input.id)
  if (typeof input.secret !== 'string' || input.secret.trim().length === 0) {
    throw new Error('empty secret')
  }
  return { kind: 'paste', id, secret: input.secret.trim() }
}

function providerForPaste(id: ConnectMethodId): Provider {
  const provider = PROVIDERS.find((item) => item.id === id)
  if (!provider) {
    throw new Error('unknown method')
  }
  return provider
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
    const status =
      request.kind === 'probe' ? await this.probe() : await this.paste(request.id, request.secret)
    this.current = status
    this.startGate = Promise.resolve(status)
    return status
  }

  private async paste(id: ConnectMethodId, secret: string): Promise<KernelStatus> {
    const provider = providerForPaste(id)
    const file = await this.readAuth()
    if (file.kind === 'unreadable') {
      throw new Error('auth file unreadable')
    }
    const records = file.kind === 'parsed' ? { ...file.records } : {}
    records[provider.id] = { type: 'api_key', key: secret }
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
    for (const provider of PROVIDERS) {
      const fromFile = file.kind === 'parsed' && filePresent(records, provider.id)
      const fromEnv = envPresent(this.env, provider.env)
      if (fromFile || fromEnv) {
        return parseKernelStatus({ kind: 'ready', model: provider.model, methods })
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
