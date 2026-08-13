import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { openRosterDb } from './db'
import { assertSafeUuid, newWorkspaceId, workspaceDir, workspacesRoot } from './paths'

export type Workspace = {
  uuid: string
  name: string
  current: boolean
}

export type FolderStatus = 'ready' | 'error'

export type CreateResult = {
  workspace: Workspace
  folderStatus: FolderStatus
  folderError?: string
}

export class WorkspaceStore {
  private readonly db: Database.Database

  constructor(private readonly home: string) {
    this.db = openRosterDb(home)
  }

  close(): void {
    this.db.close()
  }

  list(): Workspace[] {
    const current = this.currentUuid()
    const rows = this.db
      .prepare('SELECT uuid, name FROM workspaces ORDER BY created_at ASC, uuid ASC')
      .all() as { uuid: string; name: string }[]
    return rows.map((row) => ({
      uuid: row.uuid,
      name: row.name,
      current: row.uuid === current
    }))
  }

  currentUuid(): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'current_uuid'").get() as
      | { value: string | null }
      | undefined
    return row?.value ?? null
  }

  create(rawName: string): CreateResult {
    const uuid = newWorkspaceId()
    const name = rawName.trim() === '' ? uuid : rawName.trim()
    const dir = workspaceDir(this.home, uuid)
    this.preflightCreatePath(dir)

    const insert = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO workspaces (uuid, name, created_at) VALUES (?, ?, ?)')
        .run(uuid, name, Date.now())
      this.db
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('current_uuid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .run(uuid)
    })
    insert()

    const folder = this.ensureFolder(uuid)
    return {
      workspace: { uuid, name, current: true },
      folderStatus: folder.status,
      folderError: folder.error
    }
  }

  setCurrent(uuid: string): { workspace: Workspace; folderStatus: FolderStatus; folderError?: string } {
    const id = assertSafeUuid(uuid)
    const row = this.db.prepare('SELECT uuid, name FROM workspaces WHERE uuid = ?').get(id) as
      | { uuid: string; name: string }
      | undefined
    if (!row) {
      throw new Error('unknown workspace')
    }
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('current_uuid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(id)
    const folder = this.ensureFolder(id)
    return {
      workspace: { uuid: row.uuid, name: row.name, current: true },
      folderStatus: folder.status,
      folderError: folder.error
    }
  }

  ensureFolder(uuid: string): { status: FolderStatus; error?: string; path: string } {
    const dir = workspaceDir(this.home, uuid)
    try {
      if (existsSync(dir)) {
        const stat = lstatSync(dir)
        if (stat.isSymbolicLink()) {
          return { status: 'error', error: 'workspace directory is a symlink', path: dir }
        }
        if (!stat.isDirectory()) {
          return { status: 'error', error: 'workspace path is not a directory', path: dir }
        }
        return { status: 'ready', path: dir }
      }
      mkdirSync(workspacesRoot(this.home), { recursive: true })
      mkdirSync(dir, { recursive: true })
      return { status: 'ready', path: dir }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'folder ensure failed'
      return { status: 'error', error: message, path: dir }
    }
  }

  private preflightCreatePath(dir: string): void {
    mkdirSync(workspacesRoot(this.home), { recursive: true })
    if (!existsSync(dir)) {
      return
    }
    const stat = lstatSync(dir)
    if (stat.isSymbolicLink()) {
      throw new Error('workspace path is a symlink')
    }
    if (!stat.isDirectory()) {
      throw new Error('workspace path is not a directory')
    }
    if (readdirSync(dir).length > 0) {
      throw new Error('workspace path already exists')
    }
  }
}
