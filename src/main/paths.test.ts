import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { botWork, homeAt, resolveHome, type Layout } from './paths'

const ownerPrimeAuth = join(homedir(), '.prime', 'agent', 'auth.json')

function layoutFiles(layout: Layout): string[] {
  return Object.entries(layout)
    .filter(([key]) => key !== 'root')
    .map(([, value]) => value)
}

describe('homeAt', () => {
  it('maps each slot under the resolved root', () => {
    const root = resolve('/tmp/h')
    const layout = homeAt('/tmp/h')
    expect(layout.root).toBe(root)
    expect(layout.stateDb).toBe(join(root, 'state.sqlite'))
    expect(layout.primeAuth).toBe(join(root, 'prime', 'agent', 'auth.json'))
    expect(layout.electron).toBe(join(root, 'electron'))
    expect(layout.talkDb).toBe(join(root, 'talk.sqlite'))
    expect(layout.approvalDb).toBe(join(root, 'approval.sqlite'))
    expect(layout.primeCatalog).toBe(join(root, 'prime', 'agent', 'models.json'))
    expect(layout.primeRuntimeAuth).toBe(join(root, 'prime', 'agent', 'runtime-auth.json'))
  })

  it('keeps every file path under root and off the owner prime auth file', () => {
    const layout = homeAt('/tmp/h')
    const prefix = layout.root + sep
    for (const file of layoutFiles(layout)) {
      expect(file.startsWith(prefix)).toBe(true)
      expect(file).not.toBe(ownerPrimeAuth)
    }
  })

  it('rejects an empty root', () => {
    expect(() => homeAt('')).toThrow('empty cohort home')
    expect(() => homeAt('   ')).toThrow('empty cohort home')
  })
})

describe('resolveHome', () => {
  it('uses ~/.cohort when COHORT_HOME is missing or blank', () => {
    const root = resolve(join(homedir(), '.cohort'))
    expect(resolveHome({}).root).toBe(root)
    expect(resolveHome({ COHORT_HOME: '   ' }).root).toBe(root)
    expect(resolveHome({}).primeAuth).toBe(join(root, 'prime', 'agent', 'auth.json'))
    expect(resolveHome({}).electron).toBe(join(root, 'electron'))
    expect(resolveHome({}).primeAuth).not.toBe(ownerPrimeAuth)
  })

  it('resolves a non-blank COHORT_HOME', () => {
    expect(resolveHome({ COHORT_HOME: '/x/y' }).root).toBe(resolve('/x/y'))
  })
})

describe('botWork', () => {
  it('joins a safe bot id under prime-work', () => {
    const root = homeAt('/tmp/h').root
    expect(botWork(root, 'chief')).toBe(join(resolve('/tmp/h'), 'prime-work', 'chief'))
  })

  it('rejects empty, dot, and separator bot ids', () => {
    const root = homeAt('/tmp/h').root
    for (const botId of ['', '.', '..', 'a/b']) {
      expect(() => botWork(root, botId)).toThrow('invalid bot id')
    }
  })
})

describe('source policy', () => {
  it('keeps COHORT_HOME, .prime, homedir, and tmpdir inside paths.ts', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const banned = ['COHORT_HOME', 'homedir(', 'tmpdir(']
    const files = readdirSync(dir).filter(
      (name) =>
        name.endsWith('.ts') &&
        name !== 'paths.ts' &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('test-util.ts')
    )
    const hits: string[] = []
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8')
      for (const token of banned) {
        if (source.includes(token)) hits.push(`${name}: ${token}`)
      }
      if (/\.prime(?![A-Za-z])/.test(source)) hits.push(`${name}: .prime`)
    }
    expect(hits).toEqual([])
  })
})
