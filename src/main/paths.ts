import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type HomeRoot = string & { readonly __brand: 'HomeRoot' }

const RELATIVE = {
  stateDb: ['state.sqlite'],
  talkDb: ['talk.sqlite'],
  approvalDb: ['approval.sqlite'],
  electron: ['electron'],
  primeAuth: ['prime', 'agent', 'auth.json'],
  primeCatalog: ['prime', 'agent', 'models.json'],
  primeRuntimeAuth: ['prime', 'agent', 'runtime-auth.json']
} as const

type Slot = keyof typeof RELATIVE

export type Layout = { readonly root: HomeRoot } & { readonly [K in Slot]: string }

export type HomeEnv = {
  readonly COHORT_HOME?: string
  readonly [key: string]: string | undefined
}

export function resolveHome(env: HomeEnv = process.env): Layout {
  const raw = env.COHORT_HOME
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const root = trimmed.length > 0 ? trimmed : join(homedir(), '.cohort')
  return homeAt(root)
}

export function homeAt(root: string): Layout {
  const trimmed = root.trim()
  if (trimmed.length === 0) throw new Error('empty cohort home')
  const abs = resolve(trimmed) as HomeRoot
  const files = {} as { [K in Slot]: string }
  for (const slot of Object.keys(RELATIVE) as Slot[]) {
    files[slot] = join(abs, ...RELATIVE[slot])
  }
  return { root: abs, ...files }
}

export function botWork(root: HomeRoot, botId: string): string {
  if (
    botId.length === 0 ||
    botId === '.' ||
    botId === '..' ||
    botId.includes('/') ||
    botId.includes('\\')
  ) {
    throw new Error('invalid bot id')
  }
  return join(root, 'prime-work', botId)
}
