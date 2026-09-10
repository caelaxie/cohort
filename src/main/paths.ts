import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultCohortHome(): string {
  return join(homedir(), '.cohort')
}

export function stateDbPath(home: string): string {
  return join(home, 'state.sqlite')
}
