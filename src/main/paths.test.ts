import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { electronUserData, primeAuthPath, primeWorkDir, resolveHome, stateDbPath } from './paths'

const defaultHome = resolve(join(homedir(), '.cohort'))
const ownerPrimeAuth = join(homedir(), '.prime', 'agent', 'auth.json')

describe('resolveHome', () => {
  it('uses ~/.cohort when COHORT_HOME is missing or blank', () => {
    expect(resolveHome({})).toBe(defaultHome)
    expect(resolveHome({ COHORT_HOME: '   ' })).toBe(defaultHome)
  })

  it('resolves a non-blank COHORT_HOME', () => {
    expect(resolveHome({ COHORT_HOME: '/x/y' })).toBe(resolve('/x/y'))
  })
})

describe('joins', () => {
  it('puts auth and electron under home, not ~/.prime', () => {
    expect(primeAuthPath(defaultHome)).toBe(join(defaultHome, 'prime', 'agent', 'auth.json'))
    expect(primeAuthPath(defaultHome)).not.toBe(ownerPrimeAuth)
    expect(electronUserData(defaultHome)).toBe(join(defaultHome, 'electron'))
    expect(stateDbPath(defaultHome)).toBe(join(defaultHome, 'state.sqlite'))
  })
})

describe('primeWorkDir', () => {
  it('joins a safe bot id under prime-work', () => {
    expect(primeWorkDir('/tmp/h', 'chief')).toBe(join('/tmp/h', 'prime-work', 'chief'))
  })

  it('rejects empty, dot, and separator bot ids', () => {
    for (const botId of ['', '.', '..', 'a/b']) {
      expect(() => primeWorkDir('/tmp/h', botId)).toThrow('invalid bot id')
    }
  })
})
