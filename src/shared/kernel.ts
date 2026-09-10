export type ConnectMethodId = string & { readonly __brand: 'ConnectMethodId' }

export type ConnectMethod = {
  readonly id: ConnectMethodId
  readonly label: string
  readonly kind: 'paste' | 'probe'
}

export type KernelStatus =
  | { readonly kind: 'needs_login'; readonly methods: readonly ConnectMethod[] }
  | { readonly kind: 'ready'; readonly model: string; readonly methods: readonly ConnectMethod[] }

const SECRET_FIELDS = ['key', 'apiKey', 'token', 'secret', 'access', 'password'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readyForTalk(
  status: KernelStatus
): status is Extract<KernelStatus, { kind: 'ready' }> {
  return status.kind === 'ready'
}

export function parseConnectMethodId(value: unknown): ConnectMethodId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid method id')
  }
  return value as ConnectMethodId
}

function parseConnectMethod(value: unknown): ConnectMethod {
  if (!isRecord(value)) {
    throw new Error('invalid method')
  }
  const id = parseConnectMethodId(value.id)
  if (typeof value.label !== 'string' || value.label.length === 0) {
    throw new Error('invalid method')
  }
  if (value.kind !== 'paste' && value.kind !== 'probe') {
    throw new Error('invalid method')
  }
  return { id, label: value.label, kind: value.kind }
}

function parseMethods(value: unknown): readonly ConnectMethod[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('missing methods')
  }
  return value.map(parseConnectMethod)
}

function assertNoSecretFields(value: Record<string, unknown>): void {
  for (const field of SECRET_FIELDS) {
    if (field in value) {
      throw new Error('secret field')
    }
  }
}

export function parseKernelStatus(value: unknown): KernelStatus {
  if (!isRecord(value)) {
    throw new Error('invalid kernel status')
  }
  assertNoSecretFields(value)
  if (value.kind === 'needs_login') {
    return { kind: 'needs_login', methods: parseMethods(value.methods) }
  }
  if (value.kind === 'ready') {
    if (typeof value.model !== 'string' || value.model.length === 0) {
      throw new Error('missing model')
    }
    return { kind: 'ready', model: value.model, methods: parseMethods(value.methods) }
  }
  throw new Error('unknown kind')
}
