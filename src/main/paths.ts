import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

export function newWorkspaceId(): string {
  return randomUUID()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function defaultCohortHome(): string {
  return join(homedir(), '.cohort')
}

export function workspacesRoot(home: string): string {
  return join(home, 'workspaces')
}

export function stateDbPath(home: string): string {
  return join(home, 'state.sqlite')
}

export function assertSafeUuid(uuid: string): string {
  if (!UUID_RE.test(uuid)) {
    throw new Error('invalid workspace id')
  }
  return uuid.toLowerCase()
}

export function workspaceDir(home: string, uuid: string): string {
  const id = assertSafeUuid(uuid)
  const root = resolve(workspacesRoot(home))
  const dir = resolve(join(root, id))
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new Error('workspace path escaped root')
  }
  return dir
}
