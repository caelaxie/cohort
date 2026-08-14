import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAppState } from './app-state'
import { copyFilesIntoWorkspace } from './files'
import { WorkspaceStore } from './workspaces'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-app-state-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('buildAppState', () => {
  it('lists names after a successful copy', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('Alpha')
    const notes = join(home, 'notes.md')
    const shot = join(home, 'shot.png')
    writeFileSync(notes, 'n')
    writeFileSync(shot, 'p')
    const report = copyFilesIntoWorkspace(home, created.workspace.uuid, [notes, shot])
    expect(report.copied).toBe(2)
    const state = buildAppState({
      home,
      workspaces: store.list(),
      boxStatus: 'none'
    })
    expect(state.files).toEqual(['notes.md', 'shot.png'])
    store.close()
  })

  it('lists only the current workspace files after switch', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const alpha = store.create('Alpha')
    const beta = store.create('Beta')
    writeFileSync(join(home, 'notes.md'), 'n')
    writeFileSync(join(home, 'other.txt'), 'o')
    copyFilesIntoWorkspace(home, alpha.workspace.uuid, [join(home, 'notes.md')])
    copyFilesIntoWorkspace(home, beta.workspace.uuid, [join(home, 'other.txt')])
    const state = buildAppState({
      home,
      workspaces: store.list(),
      boxStatus: 'none'
    })
    expect(state.files).toEqual(['other.txt'])
    store.close()
  })

  it('omits the file list when no workspace is current', () => {
    const home = tempHome()
    const state = buildAppState({
      home,
      workspaces: [],
      boxStatus: 'none'
    })
    expect(state).not.toHaveProperty('files')
  })

  it('yields an empty list for a current empty folder', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    store.create('Alpha')
    const state = buildAppState({
      home,
      workspaces: store.list(),
      boxStatus: 'none'
    })
    expect(state.files).toEqual([])
    store.close()
  })

  it('publishes files that landed after a partial copy', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('Alpha')
    const notes = join(home, 'notes.md')
    const folder = join(home, 'dir')
    writeFileSync(notes, 'n')
    mkdirSync(folder)
    const report = copyFilesIntoWorkspace(home, created.workspace.uuid, [notes, folder])
    expect(report.copied).toBe(1)
    expect(report.error).toBeDefined()
    const state = buildAppState({
      home,
      workspaces: store.list(),
      boxStatus: 'none'
    })
    expect(state.files).toEqual(['notes.md'])
    store.close()
  })

  it('yields an empty list when folderError is set and keeps the error', () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const created = store.create('Alpha')
    writeFileSync(join(home, 'notes.md'), 'n')
    copyFilesIntoWorkspace(home, created.workspace.uuid, [join(home, 'notes.md')])
    const state = buildAppState({
      home,
      workspaces: store.list(),
      boxStatus: 'none',
      folderError: 'workspace directory is a symlink'
    })
    expect(state.files).toEqual([])
    expect(state.folderError).toBe('workspace directory is a symlink')
    store.close()
  })
})
