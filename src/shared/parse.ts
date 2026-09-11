export const SECRET_FIELDS = ['key', 'apiKey', 'token', 'secret', 'access', 'password'] as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function rejectSecrets(value: Record<string, unknown>): void {
  for (const field of SECRET_FIELDS) {
    if (field in value) {
      throw new Error('secret field')
    }
  }
}
