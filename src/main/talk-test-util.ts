import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHIEF_ID } from '../shared/roster'
import type { Turn } from './turn'

export function talkHomes(): {
  readonly tempHome: () => string
  readonly cleanup: () => void
} {
  const homes: string[] = []
  return {
    tempHome() {
      const home = mkdtempSync(join(tmpdir(), 'cohort-talk-'))
      homes.push(home)
      return home
    },
    cleanup() {
      for (const dir of homes.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }
}

export function ids(): () => string {
  let n = 0
  return () => `m${++n}`
}

export function chiefKnown(id: string): boolean {
  return id === CHIEF_ID
}

export function reply(body: string): Turn {
  return async () => ({ kind: 'ok', body })
}
