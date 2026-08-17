import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CaptainHost, PrimeSdkError, type PrimeModule } from './captain'
import { WorkspaceStore } from './workspaces'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cohort-captain-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

type CapturedBindings = {
  cwd: string
  agentDir: string
  sessionDir: string
  prompts: string[]
}

function fakeModule(): {
  module: PrimeModule
  captured: CapturedBindings[]
  bashWirings: Array<{
    cwd: string
    exec: (
      command: string,
      cwd: string,
      hooks: { onData: (data: Buffer) => void }
    ) => Promise<{ exitCode: number | null }>
  }>
} {
  const captured: CapturedBindings[] = []
  const bashWirings: Array<{
    cwd: string
    exec: (
      command: string,
      cwd: string,
      hooks: { onData: (data: Buffer) => void }
    ) => Promise<{ exitCode: number | null }>
  }> = []
  const module: PrimeModule = {
    createAgentSession: async (options) => {
      const manager = options.sessionManager as { sessionDir?: string }
      captured.push({
        cwd: options.cwd,
        agentDir: options.agentDir,
        sessionDir: String(manager.sessionDir),
        prompts: []
      })
      const listeners: Array<(event: unknown) => void> = []
      return {
        session: {
          prompt: async (text: string) => {
            captured[captured.length - 1].prompts.push(text)
            for (const listener of listeners) {
              listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
              listener({ type: 'message_end' })
              listener({ type: 'agent_end' })
            }
          },
          subscribe: (listener: (event: unknown) => void) => {
            listeners.push(listener)
            return () => undefined
          },
          dispose: () => undefined
        }
      } as unknown as Awaited<ReturnType<PrimeModule['createAgentSession']>>
    },
    ModelRuntime: {
      create: async () => ({})
    },
    DefaultResourceLoader: class {
      constructor(_options: unknown) {}
      async reload(): Promise<void> {}
    } as unknown as PrimeModule['DefaultResourceLoader'],
    SessionManager: {
      create: (_cwd: string, sessionDir: string) => ({ sessionDir }),
      continueRecent: (_cwd: string, sessionDir: string) => ({ sessionDir }),
      inMemory: () => ({})
    },
    getAgentDir: () => '/tmp/fake-owner-agent',
    createBashToolDefinition: (
      cwd: string,
      options: {
        operations: {
          exec: (
            command: string,
            cwd: string,
            hooks: { onData: (data: Buffer) => void }
          ) => Promise<{ exitCode: number | null }>
        }
      }
    ) => {
      bashWirings.push({ cwd, exec: options.operations.exec })
      return { name: 'bash' }
    }
  }
  return { module, captured, bashWirings }
}


describe('CaptainHost isolation (U3)', () => {
  it('pins cwd, agentDir, and sessionDir to one workspace uuid (AE4)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const b = store.create('B')
    const { module, captured } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'hello A')
    await host.send(b.workspace.uuid, 'hello B')
    expect(captured).toHaveLength(2)
    const [aBind, bBind] = captured
    expect(aBind.cwd).toContain(a.workspace.uuid)
    expect(aBind.cwd).not.toContain(b.workspace.uuid)
    expect(aBind.agentDir).toContain(a.workspace.uuid)
    expect(aBind.sessionDir).toContain(a.workspace.uuid)
    expect(bBind.cwd).toContain(b.workspace.uuid)
    expect(bBind.agentDir).not.toBe(aBind.agentDir)
    expect(bBind.sessionDir).not.toBe(aBind.sessionDir)
    expect(aBind.prompts).toEqual(['hello A'])
    expect(bBind.prompts).toEqual(['hello B'])
    await host.disposeAll()
    store.close()
  })

  it('reuses one session per uuid and keeps thread state between sends', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, captured } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'first')
    await host.send(a.workspace.uuid, 'second')
    expect(captured).toHaveLength(1)
    expect(captured[0].prompts).toEqual(['first', 'second'])
    await host.disposeAll()
    store.close()
  })

  it('rejects an unknown or unsafe uuid before opening any session', async () => {
    const home = tempHome()
    const { module, captured } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await expect(host.send('not-a-uuid', 'hi')).rejects.toThrow(/unknown workspace/)
    await expect(
      host.send('99999999-9999-4999-8999-999999999999', 'hi')
    ).rejects.toThrow(/unknown workspace/)
    expect(captured).toHaveLength(0)
    await host.disposeAll()
  })

  it('wraps SDK load and create failures in PrimeSdkError', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const failing = {
      ...fakeModule().module,
      createAgentSession: async () => {
        throw new Error('nope')
      }
    } as unknown as PrimeModule
    const host = new CaptainHost(home, async () => failing)
    await expect(host.send(a.workspace.uuid, 'hi')).rejects.toBeInstanceOf(PrimeSdkError)
    await host.disposeAll()
    store.close()
  })

  it('reports working state while a turn is in flight and idle after (AE1)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    const seen: boolean[] = []
    host.onWorkingChange(() => {
      seen.push(host.isWorking(a.workspace.uuid))
    })
    await host.send(a.workspace.uuid, 'hello')
    expect(host.isWorking(a.workspace.uuid)).toBe(false)
    expect(seen).toContain(true)
    await host.disposeAll()
    store.close()
  })

  it('loads a saved thread from the reserved history directory on demand (AE7)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'remember this')
    // Simulate a persisted thread on disk after quit.
    const agentDir = join(home, 'workspaces', a.workspace.uuid, '.prime', 'agent')
    const threadFile = join(agentDir, 'thread.json')
    writeFileSync(
      threadFile,
      JSON.stringify([
        { role: 'user', text: 'remember this' },
        { role: 'assistant', text: 'saved reply' }
      ])
    )
    const fresh = new CaptainHost(home, async () => module)
    const thread = await fresh.loadThread(
      a.workspace.uuid,
      () => existsSync(threadFile),
      () => readFileSync(threadFile, 'utf8')
    )
    expect(thread).toEqual([
      { role: 'user', text: 'remember this' },
      { role: 'assistant', text: 'saved reply' }
    ])
    const empty = new CaptainHost(home, async () => module)
    const missing = await empty.loadThread(
      a.workspace.uuid,
      () => false,
      () => ''
    )
    expect(missing).toBeNull()
    await host.disposeAll()
    await fresh.disposeAll()
    store.close()
  })

  it('keeps session files inside the workspace .prime directory (KTD6)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'hi')
    const workspaceRoot = join(home, 'workspaces', a.workspace.uuid)
    const agentDir = join(workspaceRoot, '.prime', 'agent')
    expect(existsSync(agentDir)).toBe(true)
    expect(readFileSync(join(agentDir, 'marker'), 'utf8')).toBe('cohort')
    await host.disposeAll()
    store.close()
  })

  it('surfacing a file-change event calls the registered listener (AE3 push seam)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    const seen: string[] = []
    host.onFileChange((uuid) => {
      seen.push(uuid)
    })
    await host.send(a.workspace.uuid, 'write a file')
    expect(seen).toEqual([a.workspace.uuid])
    await host.disposeAll()
    store.close()
  })

  it('binds the bash tool to that workspace box runner, not the host (KTD5/AE4)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, bashWirings } = fakeModule()
    const ranIn: Array<{ uuid: string; command: string }> = []
    const host = new CaptainHost(home, async () => module, {
      boxRunner: (uuid) => async (command) => {
        ranIn.push({ uuid, command })
        return { exitCode: 0, stdout: `ran ${command} in ${uuid}`, stderr: '' }
      }
    })
    await host.send(a.workspace.uuid, 'list the files')
    const outcome = await bashWirings[0].exec('ls /workspace', bashWirings[0].cwd, {
      onData: () => undefined
    })
    expect(bashWirings[0].cwd).toContain(a.workspace.uuid)
    expect(outcome.exitCode).toBe(0)
    expect(ranIn).toEqual([{ uuid: a.workspace.uuid, command: 'ls /workspace' }])
    await host.disposeAll()
    store.close()
  })
})

