import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyFilesIntoWorkspace, destinationName } from './files'
import { WorkspaceStore } from './workspaces'
import { workspaceDir } from './paths'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-files-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('copyFilesIntoWorkspace', () => {
  it('copies a file into the current uuid folder', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const source = join(home, 'a.txt')
    writeFileSync(source, 'hello')
    const report = copyFilesIntoWorkspace(home, created.workspace.uuid, [source])
    expect(report.copied).toBe(1)
    expect(readFileSync(join(workspaceDir(home, created.workspace.uuid), 'a.txt'), 'utf8')).toBe(
      'hello'
    )
    store.close()
  })

  it('suffixes an existing name', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'a.txt'), 'old')
    const source = join(home, 'a.txt')
    writeFileSync(source, 'new')
    copyFilesIntoWorkspace(home, created.workspace.uuid, [source])
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('old')
    expect(readFileSync(join(dir, 'a (1).txt'), 'utf8')).toBe('new')
    store.close()
  })

  it('rejects a directory', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const folder = join(home, 'dir')
    mkdirSync(folder)
    const report = copyFilesIntoWorkspace(home, created.workspace.uuid, [folder])
    expect(report.copied).toBe(0)
    expect(report.error).toMatch(/regular files/)
    store.close()
  })

  it('rejects a basename that is empty or a traversal segment', () => {
    expect(() => destinationName('..')).toThrow('invalid file name')
    expect(() => destinationName('.')).toThrow('invalid file name')
  })

  it('copies after switch into the new current folder', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const b = store.create('B')
    const source = join(home, 'x.txt')
    writeFileSync(source, 'x')
    copyFilesIntoWorkspace(home, b.workspace.uuid, [source])
    expect(readFileSync(join(workspaceDir(home, b.workspace.uuid), 'x.txt'), 'utf8')).toBe('x')
    expect(() => readFileSync(join(workspaceDir(home, a.workspace.uuid), 'x.txt'))).toThrow()
    store.close()
  })
})
