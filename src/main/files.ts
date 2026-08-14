import { copyFileSync, existsSync, lstatSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { workspaceDir } from './paths'

export type CopyReport = {
  copied: number
  total: number
  error?: string
}

export function destinationName(sourcePath: string): string {
  const name = basename(sourcePath)
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('invalid file name')
  }
  return name
}

function uniquePath(dir: string, name: string): string {
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = join(dir, name)
  let index = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${index})${ext}`)
    index += 1
  }
  return candidate
}

export function copyFilesIntoWorkspace(home: string, uuid: string, sources: string[]): CopyReport {
  const dir = workspaceDir(home, uuid)
  if (!existsSync(dir) || !lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) {
    return { copied: 0, total: sources.length, error: 'workspace folder is not writable' }
  }

  let copied = 0
  let lastError: string | undefined
  for (const source of sources) {
    try {
      const stat = lstatSync(source)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        lastError = 'only regular files can be added'
        continue
      }
      const name = destinationName(source)
      const dest = uniquePath(dir, name)
      if (lstatSync(dir).isSymbolicLink()) {
        throw new Error('workspace folder is a symlink')
      }
      copyFileSync(source, dest)
      copied += 1
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'copy failed'
    }
  }

  if (copied === 0 && lastError) {
    return { copied, total: sources.length, error: lastError }
  }
  return { copied, total: sources.length, error: copied === sources.length ? undefined : lastError }
}
