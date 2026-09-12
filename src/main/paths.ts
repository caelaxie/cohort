import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function resolveHome(env: NodeJS.Dict<string> = process.env): string {
  const raw = env.COHORT_HOME
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const root = trimmed.length > 0 ? trimmed : join(homedir(), '.cohort')
  return resolve(root)
}

export function stateDbPath(home: string): string {
  return join(home, 'state.sqlite')
}

export function talkDbPath(home: string): string {
  return join(home, 'talk.sqlite')
}

export function approvalDbPath(home: string): string {
  return join(home, 'approval.sqlite')
}

export function electronUserData(home: string): string {
  return join(home, 'electron')
}

export function primeAuthPath(home: string): string {
  return join(home, 'prime', 'agent', 'auth.json')
}

export function primeWorkDir(home: string, botId: string): string {
  if (
    botId.length === 0 ||
    botId === '.' ||
    botId === '..' ||
    botId.includes('/') ||
    botId.includes('\\')
  ) {
    throw new Error('invalid bot id')
  }
  return join(home, 'prime-work', botId)
}
