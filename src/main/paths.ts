import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultCohortHome(): string {
  return join(homedir(), '.cohort')
}

export function stateDbPath(home: string): string {
  return join(home, 'state.sqlite')
}

export function kernelAuthPath(home: string): string {
  if (process.env.COHORT_HOME) {
    return join(home, 'prime', 'agent', 'auth.json')
  }
  return join(homedir(), '.prime', 'agent', 'auth.json')
}
