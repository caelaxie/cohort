import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ENDPOINT_PRESETS, type KernelStatus } from '../shared/kernel'

export type KernelOptions = {
  readonly env: NodeJS.Dict<string>
  readonly primeAuthPath: string
}

const COMPLETIONS_RECORD = 'openai-completions'

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

export type Endpoint = {
  readonly model: string
  readonly baseUrl: string
  readonly key: string
}

function envKey(env: NodeJS.Dict<string>, name: string): string | null {
  const value = env[name]
  if (typeof value !== 'string') {
    return null
  }
  const key = value.trim()
  return key.length > 0 ? key : null
}

function fileKey(records: Record<string, unknown>, name: string): string | null {
  const entry = records[name]
  if (!isRecord(entry) || entry.type !== 'api_key' || typeof entry.key !== 'string') {
    return null
  }
  const key = entry.key.trim()
  return key.length > 0 ? key : null
}

function completionsEndpoint(value: unknown): Endpoint | null {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.trim().length === 0) {
    return null
  }
  if (typeof value.model !== 'string' || value.model.trim().length === 0) {
    return null
  }
  try {
    return {
      model: value.model.trim(),
      baseUrl: parseBaseUrl(value.baseUrl),
      key: value.key.trim()
    }
  } catch {
    return null
  }
}

function ready(model: string, baseUrl: string): KernelStatus {
  return { kind: 'ready', model, baseUrl }
}

export class Kernel {
  private readonly env: NodeJS.Dict<string>
  private readonly primeAuthPath: string

  constructor(options: KernelOptions) {
    this.env = options.env
    this.primeAuthPath = options.primeAuthPath
  }

  async status(): Promise<KernelStatus> {
    const endpoint = await this.resolve()
    return endpoint === null ? { kind: 'needs_login' } : ready(endpoint.model, endpoint.baseUrl)
  }

  endpoint(): Promise<Endpoint | null> {
    return this.resolve()
  }

  async connect(input?: unknown): Promise<KernelStatus> {
    const request = parseConnectRequest(input)
    return request.kind === 'probe' ? this.status() : this.paste(request)
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
    return this.status()
  }

  private async resolve(): Promise<Endpoint | null> {
    const file = await this.readAuth()
    const records = file.kind === 'parsed' ? file.records : {}
    const custom = completionsEndpoint(records[COMPLETIONS_RECORD])
    if (custom) {
      return custom
    }
    for (const preset of ENDPOINT_PRESETS) {
      const fromFile = file.kind === 'parsed' ? fileKey(records, preset.fileKey) : null
      if (fromFile) {
        return { model: preset.model, baseUrl: preset.baseUrl, key: fromFile }
      }
      const fromEnv = envKey(this.env, preset.env)
      if (fromEnv) {
        return { model: preset.model, baseUrl: preset.baseUrl, key: fromEnv }
      }
    }
    return null
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
