import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseKernelStatus } from '../shared/kernel'
import { Kernel } from './kernel'

const homes: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cohort-kernel-'))
  homes.push(dir)
  return dir
}

const methods = [
  { id: 'probe', label: 'Use a key already on this Mac', kind: 'probe' },
  { id: 'xai', label: 'xAI', kind: 'paste' },
  { id: 'openai', label: 'OpenAI', kind: 'paste' },
  { id: 'anthropic', label: 'Anthropic', kind: 'paste' }
]

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Kernel', () => {
  it('needs_login when no file and no env, and start twice is the same promise', async () => {
    const authPath = join(tempDir(), 'auth.json')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    const first = kernel.start()
    const second = kernel.start()
    expect(second).toBe(first)
    expect(await first).toEqual({ kind: 'needs_login', methods })
    expect(await second).toEqual({ kind: 'needs_login', methods })
  })

  it('is ready with grok-4.5 from XAI_API_KEY and the payload JSON has no key', async () => {
    const kernel = new Kernel({
      env: { XAI_API_KEY: 'sk-env' },
      primeAuthPath: join(tempDir(), 'auth.json')
    })
    const status = await kernel.start()
    expect(status).toEqual({ kind: 'ready', model: 'grok-4.5', methods })
    expect(JSON.stringify(status).includes('"key"')).toBe(false)
    expect(JSON.parse(JSON.stringify(status))).toEqual({
      kind: 'ready',
      model: 'grok-4.5',
      methods
    })
  })

  it('prefers auth.json xai over env XAI_API_KEY as one source', async () => {
    const authPath = join(tempDir(), 'auth.json')
    writeFileSync(authPath, JSON.stringify({ xai: { type: 'api_key', key: 'sk-file' } }), 'utf8')
    const kernel = new Kernel({
      env: { XAI_API_KEY: 'sk-env' },
      primeAuthPath: authPath
    })
    expect(await kernel.start()).toEqual({ kind: 'ready', model: 'grok-4.5', methods })
  })

  it('paste xai creates 0600 auth.json, preserves a sibling openai key, and returns grok-4.5', async () => {
    const authPath = join(tempDir(), '.prime', 'agent', 'auth.json')
    mkdirSync(dirname(authPath), { recursive: true })
    writeFileSync(
      authPath,
      JSON.stringify({ openai: { type: 'api_key', key: 'sk-openai' } }),
      'utf8'
    )
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    const status = await kernel.connect({ kind: 'paste', id: 'xai', secret: 'sk-xai' })
    expect(status).toEqual({ kind: 'ready', model: 'grok-4.5', methods })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      openai: { type: 'api_key', key: 'sk-openai' },
      xai: { type: 'api_key', key: 'sk-xai' }
    })
    expect(statSync(authPath).mode & 0o777).toBe(0o600)
  })

  it('throws on paste with an empty secret', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await expect(kernel.connect({ kind: 'paste', id: 'xai', secret: '' })).rejects.toThrow()
  })

  it('throws unknown method for a stale paste id', async () => {
    const kernel = new Kernel({ env: {}, primeAuthPath: join(tempDir(), 'auth.json') })
    await expect(kernel.connect({ kind: 'paste', id: 'nope', secret: 'sk' })).rejects.toThrow(
      'unknown method'
    )
  })

  it('refuses paste when auth.json is not object JSON', async () => {
    const authPath = join(tempDir(), 'auth.json')
    writeFileSync(authPath, 'not-json', 'utf8')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    await expect(kernel.connect({ kind: 'paste', id: 'xai', secret: 'sk' })).rejects.toThrow(
      'auth file unreadable'
    )
    expect(readFileSync(authPath, 'utf8')).toBe('not-json')
  })

  it('start twice does not rewrite a missing file', async () => {
    const authPath = join(tempDir(), 'auth.json')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    await kernel.start()
    await kernel.start()
    expect(() => statSync(authPath)).toThrow()
  })

  it('stop does not delete auth.json and start after stop can still be ready', async () => {
    const authPath = join(tempDir(), 'auth.json')
    writeFileSync(authPath, JSON.stringify({ xai: { type: 'api_key', key: 'sk-file' } }), 'utf8')
    const kernel = new Kernel({ env: {}, primeAuthPath: authPath })
    expect(await kernel.start()).toEqual({ kind: 'ready', model: 'grok-4.5', methods })
    await kernel.stop()
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      xai: { type: 'api_key', key: 'sk-file' }
    })
    expect(await kernel.start()).toEqual({ kind: 'ready', model: 'grok-4.5', methods })
  })
})

describe('parseKernelStatus', () => {
  it('rejects ready with empty methods and a smuggled key', () => {
    expect(() => parseKernelStatus({ kind: 'ready', model: 'x', methods: [], key: 'sk' })).toThrow()
  })

  it('rejects ready without methods', () => {
    expect(() => parseKernelStatus({ kind: 'ready', model: 'x' })).toThrow()
  })

  it('rejects a connected payload that smuggles apiKey', () => {
    expect(() =>
      parseKernelStatus({
        kind: 'ready',
        model: 'grok-4.5',
        methods,
        apiKey: 'sk'
      })
    ).toThrow()
  })
})
