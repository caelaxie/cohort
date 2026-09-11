import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseKernelStatus, type KernelStatus } from '../shared/kernel'
import { SECRET_FIELDS } from '../shared/parse'
import { Kernel } from './kernel'

const homes: string[] = []

const METER_FIELDS = ['cap', 'quota', 'credits', 'weekly', 'subscription'] as const

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cohort-kernel-'))
  homes.push(dir)
  return dir
}

function expectByoStatus(status: KernelStatus): void {
  if (status.kind === 'needs_login') {
    expect(Object.keys(status)).toEqual(['kind'])
  } else {
    expect(Object.keys(status).sort()).toEqual(['baseUrl', 'kind', 'model'])
  }
  const serialized = JSON.stringify(status)
  for (const field of [...SECRET_FIELDS, ...METER_FIELDS]) {
    expect(serialized.includes(`"${field}"`)).toBe(false)
  }
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Kernel', () => {
  it('needs_login when no file and no env', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    expect(await kernel.status()).toEqual({ kind: 'needs_login' })
    expect(await kernel.status()).toEqual({ kind: 'needs_login' })
  })

  it('is ready with grok-4.5 from XAI_API_KEY and the payload JSON has no key', async () => {
    const kernel = new Kernel({
      env: { XAI_API_KEY: 'sk-env' },
      primeAuthPath: join(tempDir(), 'auth.json')
    })
    const status = await kernel.status()
    expect(status).toEqual({
      kind: 'ready',
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1'
    })
    expect(JSON.stringify(status).includes('"key"')).toBe(false)
  })

  it('is ready from auth.json xai even when XAI_API_KEY is also set', async () => {
    const authPath = join(tempDir(), 'auth.json')
    writeFileSync(authPath, JSON.stringify({ xai: { type: 'api_key', key: 'sk-file' } }), 'utf8')
    const kernel = new Kernel({
      env: { XAI_API_KEY: 'sk-env' },
      primeAuthPath: authPath
    })
    expect(await kernel.status()).toEqual({
      kind: 'ready',
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1'
    })
  })

  it('paste writes openai-completions, preserves a sibling openai key, and returns that model', async () => {
    const authPath = join(tempDir(), '.prime', 'agent', 'auth.json')
    mkdirSync(dirname(authPath), { recursive: true })
    writeFileSync(
      authPath,
      JSON.stringify({ openai: { type: 'api_key', key: 'sk-openai' } }),
      'utf8'
    )
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    const status = await kernel.connect({
      kind: 'paste',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1:8b',
      secret: 'sk'
    })
    expect(status).toEqual({
      kind: 'ready',
      model: 'llama3.1:8b',
      baseUrl: 'http://127.0.0.1:11434/v1'
    })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      openai: { type: 'api_key', key: 'sk-openai' },
      'openai-completions': {
        type: 'api_key',
        key: 'sk',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.1:8b'
      }
    })
    expect(statSync(authPath).mode & 0o777).toBe(0o600)
  })

  it('throws on paste with an empty secret', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await expect(
      kernel.connect({
        kind: 'paste',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.1:8b',
        secret: ''
      })
    ).rejects.toThrow('empty secret')
  })

  it('throws on paste with an empty model', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await expect(
      kernel.connect({
        kind: 'paste',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: '',
        secret: 'sk'
      })
    ).rejects.toThrow('empty model')
  })

  it('throws on paste with a non-http base url', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await expect(
      kernel.connect({
        kind: 'paste',
        baseUrl: 'ftp://x',
        model: 'llama3.1:8b',
        secret: 'sk'
      })
    ).rejects.toThrow('invalid base url')
  })

  it('throws on paste with credentials in the base url', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await expect(
      kernel.connect({
        kind: 'paste',
        baseUrl: 'https://user:pass@host/v1',
        model: 'llama3.1:8b',
        secret: 'sk'
      })
    ).rejects.toThrow('invalid base url')
  })

  it('refuses paste when auth.json is not object JSON', async () => {
    const authPath = join(tempDir(), 'auth.json')
    writeFileSync(authPath, 'not-json', 'utf8')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    await expect(
      kernel.connect({
        kind: 'paste',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.1:8b',
        secret: 'sk'
      })
    ).rejects.toThrow('auth file unreadable')
    expect(readFileSync(authPath, 'utf8')).toBe('not-json')
  })

  it('status does not create a missing file', async () => {
    const authPath = join(tempDir(), 'auth.json')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    await kernel.status()
    await kernel.status()
    expect(() => statSync(authPath)).toThrow()
  })

  it('endpoint returns the env key and status JSON still has no key', async () => {
    const kernel = new Kernel({
      env: { XAI_API_KEY: 'sk-env' },
      primeAuthPath: join(tempDir(), 'auth.json')
    })
    expect(await kernel.endpoint()).toEqual({
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1',
      key: 'sk-env'
    })
    expect(JSON.stringify(await kernel.status()).includes('"key"')).toBe(false)
  })

  it('endpoint is null when status is needs_login', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    expect(await kernel.endpoint()).toBeNull()
    expect(await kernel.status()).toEqual({ kind: 'needs_login' })
  })

  it('endpoint returns the pasted openai-completions key', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await kernel.connect({
      kind: 'paste',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1:8b',
      secret: 'sk'
    })
    expect(await kernel.endpoint()).toEqual({
      model: 'llama3.1:8b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      key: 'sk'
    })
  })

  it('connect does not delete a sibling xai key', async () => {
    const authPath = join(tempDir(), 'auth.json')
    writeFileSync(authPath, JSON.stringify({ xai: { type: 'api_key', key: 'sk-file' } }), 'utf8')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    expect(await kernel.status()).toEqual({
      kind: 'ready',
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1'
    })
    await kernel.connect({
      kind: 'paste',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1:8b',
      secret: 'sk'
    })
    expect(JSON.parse(readFileSync(authPath, 'utf8')).xai).toEqual({
      type: 'api_key',
      key: 'sk-file'
    })
  })

  it('status and connect never expose a Cohort cap or secrets', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    expectByoStatus(await kernel.status())
    expectByoStatus(await kernel.connect({ kind: 'probe' }))
    expectByoStatus(
      await kernel.connect({
        kind: 'paste',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.1:8b',
        secret: 'sk-secret'
      })
    )
  })
})

describe('parseKernelStatus', () => {
  it('rejects ready without baseUrl', () => {
    expect(() => parseKernelStatus({ kind: 'ready', model: 'x' })).toThrow()
  })

  it('rejects a connected payload that smuggles apiKey', () => {
    expect(() =>
      parseKernelStatus({
        kind: 'ready',
        model: 'grok-4.5',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: 'sk'
      })
    ).toThrow()
  })

  it('drops a smuggled weekly cap and keeps secrets off the wire', () => {
    const status = parseKernelStatus({
      kind: 'ready',
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1',
      cap: 100,
      weekly: true,
      quota: 'unlimited',
      credits: 0,
      subscription: 'cohort'
    })
    expectByoStatus(status)
    expect(status).toEqual({
      kind: 'ready',
      model: 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1'
    })
  })
})
