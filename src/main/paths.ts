import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultCohortHome(): string {
  return join(homedir(), '.cohort')
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

export function primeWorkDir(home: string, botId: string): string {
  return join(home, 'prime-work', botId)
}
