import { isRecord, rejectSecrets } from './parse'

export type KernelStatus =
  | { readonly kind: 'needs_login' }
  | { readonly kind: 'ready'; readonly model: string; readonly baseUrl: string }

export const ENDPOINT_PRESETS = [
  {
    label: 'xAI',
    fileKey: 'xai',
    env: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.5'
  },
  {
    label: 'OpenAI',
    fileKey: 'openai',
    env: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1'
  }
] as const

export function readyForTalk(
  status: KernelStatus
): status is Extract<KernelStatus, { kind: 'ready' }> {
  return status.kind === 'ready'
}

export function parseKernelStatus(value: unknown): KernelStatus {
  if (!isRecord(value)) {
    throw new Error('invalid kernel status')
  }
  rejectSecrets(value)
  if (value.kind === 'needs_login') {
    return { kind: 'needs_login' }
  }
  if (value.kind === 'ready') {
    if (typeof value.model !== 'string' || value.model.length === 0) {
      throw new Error('missing model')
    }
    if (typeof value.baseUrl !== 'string' || value.baseUrl.length === 0) {
      throw new Error('missing base url')
    }
    return { kind: 'ready', model: value.model, baseUrl: value.baseUrl }
  }
  throw new Error('unknown kind')
}
