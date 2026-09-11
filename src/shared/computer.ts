import { isRecord, rejectSecrets } from './parse'

export const SHARED_SESSION = 'default' as const

export const SHARED_PROFILE = {
  kind: 'shared',
  session: SHARED_SESSION
} as const

export type SharedProfile = typeof SHARED_PROFILE

export type ComputerStatus =
  { readonly kind: 'ready'; readonly profile: SharedProfile } | { readonly kind: 'stopped' }

export type ComputerResult<T = unknown> =
  | { readonly kind: 'done'; readonly value: T }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }

export function parseSharedProfile(value: unknown): SharedProfile {
  if (!isRecord(value)) {
    throw new Error('invalid profile')
  }
  rejectSecrets(value)
  if (value.kind !== 'shared' || value.session !== SHARED_SESSION) {
    throw new Error('invalid profile')
  }
  return SHARED_PROFILE
}

export function parseComputerStatus(value: unknown): ComputerStatus {
  if (!isRecord(value)) {
    throw new Error('invalid computer')
  }
  rejectSecrets(value)
  if (value.kind === 'stopped') {
    return { kind: 'stopped' }
  }
  if (value.kind === 'ready') {
    return { kind: 'ready', profile: parseSharedProfile(value.profile) }
  }
  throw new Error('unknown kind')
}

export function parseComputerResult(value: unknown): ComputerResult {
  if (!isRecord(value)) {
    throw new Error('invalid computer result')
  }
  rejectSecrets(value)
  if (value.kind === 'unavailable' || value.kind === 'denied') {
    return { kind: value.kind }
  }
  if (value.kind === 'done') {
    return { kind: 'done', value: value.value }
  }
  throw new Error('unknown kind')
}
