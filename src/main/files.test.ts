import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyFilesIntoWorkspace, destinationName, listWorkspaceFiles } from './files'
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

describe('listWorkspaceFiles', () => {
  it('returns a root file by its file name', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'notes.txt'), 'n')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['notes.txt'])
    store.close()
  })

  it('returns a nested file by its relative path', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    mkdirSync(join(dir, 'drafts'))
    writeFileSync(join(dir, 'drafts', 'idea.md'), 'idea')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['drafts/idea.md'])
    store.close()
  })

  it('returns an empty list for an empty folder', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual([])
    store.close()
  })

  it('includes a regular dotfile', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, '.env'), 'secret')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['.env'])
    store.close()
  })

  it('omits a symlink file and a symlink directory', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(home, 'real.txt'), 'real')
    const outside = join(home, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'leaked.txt'), 'no')
    symlinkSync(join(home, 'real.txt'), join(dir, 'link.txt'))
    symlinkSync(outside, join(dir, 'linkdir'))
    writeFileSync(join(dir, 'ok.txt'), 'ok')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['ok.txt'])
    store.close()
  })

  it('returns a suffixed copy name as on disk', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'a (1).txt'), 'copy')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['a (1).txt'])
    store.close()
  })

  it('sorts names by relative path', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'z.txt'), 'z')
    writeFileSync(join(dir, 'a.txt'), 'a')
    mkdirSync(join(dir, 'drafts'))
    writeFileSync(join(dir, 'drafts', 'b.md'), 'b')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual([
      'a.txt',
      'drafts/b.md',
      'z.txt'
    ])
    store.close()
  })

  it('returns an empty list when the folder is missing', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    rmSync(workspaceDir(home, created.workspace.uuid), { recursive: true, force: true })
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual([])
    store.close()
  })

  it('returns an empty list when the folder is unreadable', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'a.txt'), 'a')
    chmodSync(dir, 0)
    try {
      expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual([])
    } finally {
      chmodSync(dir, 0o755)
    }
    store.close()
  })

  it('skips an unreadable nested directory and still lists readable files', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'visible.txt'), 'y')
    mkdirSync(join(dir, 'secret'))
    writeFileSync(join(dir, 'secret', 'hidden.txt'), 'x')
    chmodSync(join(dir, 'secret'), 0)
    try {
      expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['visible.txt'])
    } finally {
      chmodSync(join(dir, 'secret'), 0o755)
    }
    store.close()
  })

  it('does not include files from another workspace uuid', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const b = store.create('B')
    writeFileSync(join(workspaceDir(home, a.workspace.uuid), 'from-a.txt'), 'a')
    writeFileSync(join(workspaceDir(home, b.workspace.uuid), 'from-b.txt'), 'b')
    expect(listWorkspaceFiles(home, b.workspace.uuid)).toEqual(['from-b.txt'])
    expect(listWorkspaceFiles(home, a.workspace.uuid)).toEqual(['from-a.txt'])
    store.close()
  })

  it('excludes the reserved captain history directory from the name list (AE8)', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'notes.md'), 'n')
    const sessions = join(dir, '.prime', 'agent', 'sessions')
    mkdirSync(sessions, { recursive: true })
    writeFileSync(join(sessions, 'session.jsonl'), '{}')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['notes.md'])
    store.close()
  })

  it('lists captain-written owner files in the workspace (AE3)', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('A')
    const dir = workspaceDir(home, created.workspace.uuid)
    writeFileSync(join(dir, 'captain-draft.txt'), 'from the captain')
    expect(listWorkspaceFiles(home, created.workspace.uuid)).toEqual(['captain-draft.txt'])
    store.close()
  })
})
