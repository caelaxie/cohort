import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from './workspaces'
import * as paths from './paths'
import { workspaceDir } from './paths'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-test-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('WorkspaceStore', () => {
  it('creates a named workspace with a uuid folder', () => {
    const store = new WorkspaceStore(tempHome())
    const result = store.create('Notes')
    expect(result.workspace.name).toBe('Notes')
    expect(result.workspace.current).toBe(true)
    expect(result.folderStatus).toBe('ready')
    expect(store.list()).toHaveLength(1)
    store.close()
  })

  it('uses the uuid as the name when the name is blank', () => {
    const store = new WorkspaceStore(tempHome())
    const result = store.create('   ')
    expect(result.workspace.name).toBe(result.workspace.uuid)
    store.close()
  })

  it('treats whitespace-only names as empty', () => {
    const store = new WorkspaceStore(tempHome())
    const result = store.create('\t')
    expect(result.workspace.name).toBe(result.workspace.uuid)
    store.close()
  })

  it('allows duplicate display names', () => {
    const store = new WorkspaceStore(tempHome())
    store.create('Notes')
    store.create('Notes')
    const names = store.list().map((item) => item.name)
    expect(names).toEqual(['Notes', 'Notes'])
    store.close()
  })

  it('keeps exactly one current workspace after two creates', () => {
    const store = new WorkspaceStore(tempHome())
    const first = store.create('A')
    const second = store.create('B')
    const current = store.list().filter((item) => item.current)
    expect(current).toHaveLength(1)
    expect(current[0]?.uuid).toBe(second.workspace.uuid)
    expect(first.workspace.uuid).not.toBe(second.workspace.uuid)
    store.close()
  })

  it('ignores a uuid directory that has no roster row', () => {
    const home = tempHome()
    mkdirSync(join(home, 'workspaces', '11111111-1111-4111-8111-111111111111'), { recursive: true })
    const store = new WorkspaceStore(home)
    expect(store.list()).toEqual([])
    store.close()
  })

  it('recreates a missing registered folder on setCurrent', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('Gone')
    rmSync(workspaceDir(home, created.workspace.uuid), { recursive: true, force: true })
    const opened = store.setCurrent(created.workspace.uuid)
    expect(opened.folderStatus).toBe('ready')
    expect(store.list()[0]?.name).toBe('Gone')
    store.close()
  })

  it('rejects a non-uuid id before any filesystem join', () => {
    const store = new WorkspaceStore(tempHome())
    expect(() => store.setCurrent('../etc')).toThrow('invalid workspace id')
    store.close()
  })

  it('refuses to adopt a non-empty pre-existing directory', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const uuid = '22222222-2222-4222-8222-222222222222'
    vi.spyOn(paths, 'newWorkspaceId').mockReturnValue(uuid)
    mkdirSync(join(home, 'workspaces', uuid), { recursive: true })
    writeFileSync(join(home, 'workspaces', uuid, 'secret.txt'), 'no')
    expect(() => store.create('Steal')).toThrow('workspace path already exists')
    expect(store.list()).toEqual([])
    vi.restoreAllMocks()
    store.close()
  })

  it('rejects an unknown setCurrent', () => {
    const store = new WorkspaceStore(tempHome())
    expect(() => store.setCurrent('33333333-3333-4333-8333-333333333333')).toThrow(
      'unknown workspace'
    )
    store.close()
  })

  it('marks a symlink workspace directory as a folder error', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('Link')
    const dir = workspaceDir(home, created.workspace.uuid)
    const target = join(home, 'outside')
    mkdirSync(target)
    rmSync(dir, { recursive: true, force: true })
    symlinkSync(target, dir)
    const opened = store.ensureFolder(created.workspace.uuid)
    expect(opened.status).toBe('error')
    store.close()
  })
})


