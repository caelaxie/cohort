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
  customToolNames: string[]
}

/** One captured wiring of a confined file tool factory (R4/R5). */
type FileToolWiring = {
  name: string
  cwd: string
  operations: {
    readFile?: (absolutePath: string) => Promise<Buffer | string> | string
    writeFile?: (absolutePath: string, content: string) => Promise<void>
    access?: (absolutePath: string) => Promise<void>
    detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>
    mkdir?: (dir: string) => Promise<void>
    isDirectory?: (absolutePath: string) => Promise<boolean> | boolean
    exists?: (absolutePath: string) => Promise<boolean> | boolean
    stat?: (
      absolutePath: string
    ) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean }
    readdir?: (absolutePath: string) => Promise<string[]> | string[]
    glob?: (
      pattern: string,
      searchPath: string,
      options: { ignore: string[]; limit: number }
    ) => Promise<string[]> | string[]
  }
}

type FakePrompt = (text: string, emit: (event: unknown) => void) => Promise<void>

/** Streams a reply the way the real SDK does: message_start, deltas, end. */
const defaultPrompt: FakePrompt = async (text, emit) => {
  emit({ type: 'message_start' })
  emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
  emit({ type: 'message_end' })
  emit({ type: 'agent_end' })
}

function fakeModule(options: { prompt?: FakePrompt } = {}): {
  module: PrimeModule
  captured: CapturedBindings[]
  bashWirings: Array<{
    cwd: string
    exec: (
      command: string,
      cwd: string,
      hooks: {
        onData: (data: Buffer) => void
        signal?: AbortSignal
        timeout?: number
      }
    ) => Promise<{ exitCode: number | null }>
  }>
  fileWirings: FileToolWiring[]
} {
  const promptBehavior = options.prompt ?? defaultPrompt
  const captured: CapturedBindings[] = []
  const bashWirings: Array<{
    cwd: string
    exec: (
      command: string,
      cwd: string,
      hooks: {
        onData: (data: Buffer) => void
        signal?: AbortSignal
        timeout?: number
      }
    ) => Promise<{ exitCode: number | null }>
  }> = []
  const fileWirings: FileToolWiring[] = []
  const module: PrimeModule = {
    createAgentSession: async (options) => {
      const manager = options.sessionManager as { sessionDir?: string }
      captured.push({
        cwd: options.cwd,
        agentDir: options.agentDir,
        sessionDir: String(manager.sessionDir),
        prompts: [],
        customToolNames: (options.customTools ?? []).map((tool) =>
          String((tool as { name?: unknown }).name)
        )
      })
      const listeners: Array<(event: unknown) => void> = []
      return {
        session: {
          prompt: async (text: string) => {
            captured[captured.length - 1].prompts.push(text)
            await promptBehavior(text, (event) => {
              for (const listener of listeners) listener(event)
            })
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
      constructor(_options: unknown) {
        void _options
      }
      async reload(): Promise<void> {
        // Fake loader discovers nothing.
      }
    } as unknown as PrimeModule['DefaultResourceLoader'],
    SessionManager: {
      continueRecent: (_cwd: string, sessionDir: string) => ({ sessionDir })
    },
    createBashToolDefinition: (
      cwd: string,
      options: {
        operations: {
          exec: (
            command: string,
            cwd: string,
            hooks: {
              onData: (data: Buffer) => void
              signal?: AbortSignal
              timeout?: number
            }
          ) => Promise<{ exitCode: number | null }>
        }
      }
    ) => {
      bashWirings.push({ cwd, exec: options.operations.exec })
      return { name: 'bash' }
    },
    createReadToolDefinition: (cwd, options) => {
      fileWirings.push({ name: 'read', cwd, operations: options.operations })
      return { name: 'read' }
    },
    createWriteToolDefinition: (cwd, options) => {
      fileWirings.push({ name: 'write', cwd, operations: options.operations })
      return { name: 'write' }
    },
    createEditToolDefinition: (cwd, options) => {
      fileWirings.push({ name: 'edit', cwd, operations: options.operations })
      return { name: 'edit' }
    },
    createGrepToolDefinition: (cwd, options) => {
      fileWirings.push({ name: 'grep', cwd, operations: options.operations })
      return { name: 'grep' }
    },
    createFindToolDefinition: (cwd, options) => {
      fileWirings.push({ name: 'find', cwd, operations: options.operations })
      return { name: 'find' }
    },
    createLsToolDefinition: (cwd, options) => {
      fileWirings.push({ name: 'ls', cwd, operations: options.operations })
      return { name: 'ls' }
    }
  }
  return { module, captured, bashWirings, fileWirings }
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
    await expect(host.send('99999999-9999-4999-8999-999999999999', 'hi')).rejects.toThrow(
      /unknown workspace/
    )
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
    const seen: Array<string> = []
    host.onWorkingChange((uuid, working) => {
      seen.push(`${uuid}:${working}`)
    })
    await host.send(a.workspace.uuid, 'hello')
    expect(host.isWorking(a.workspace.uuid)).toBe(false)
    expect(seen).toEqual([`${a.workspace.uuid}:true`, `${a.workspace.uuid}:false`])
    await host.disposeAll()
    store.close()
  })

  it('loads a saved thread from the reserved history directory on demand (AE7)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('Alpha')
    const b = store.create('Beta')
    const { module } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'remember this')
    // Simulate a persisted thread on disk after quit.
    const agentDir = join(home, 'workspaces', a.workspace.uuid, '.prime', 'agent')
    writeFileSync(
      join(agentDir, 'thread.json'),
      JSON.stringify([
        { role: 'user', text: 'remember this' },
        { role: 'assistant', text: 'saved reply' }
      ])
    )
    const fresh = new CaptainHost(home, async () => module)
    const thread = await fresh.loadThread(a.workspace.uuid)
    expect(thread).toEqual([
      { role: 'user', text: 'remember this' },
      { role: 'assistant', text: 'saved reply' }
    ])
    const empty = new CaptainHost(home, async () => module)
    const missing = await empty.loadThread(b.workspace.uuid)
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
    expect(existsSync(join(agentDir, 'sessions'))).toBe(true)
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
    const { module, captured, bashWirings } = fakeModule()
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
    // The box bash rides in customTools and shadows the builtin host bash
    // by name; excludeTools would have dropped it with the builtin (KTD5).
    expect(captured[0].customToolNames).toEqual([
      'read',
      'write',
      'edit',
      'grep',
      'find',
      'ls',
      'bash'
    ])
    await host.disposeAll()
    store.close()
  })

  it('confines the file tools to the workspace even without a box runner (R4)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, captured } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'hi')
    expect(captured[0].customToolNames).toEqual(['read', 'write', 'edit', 'grep', 'find', 'ls'])
    await host.disposeAll()
    store.close()
  })

  it('file tool operations reject paths outside the workspace (R4/R5)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, fileWirings } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'hi')
    const [readWiring, writeWiring] = fileWirings
    expect(readWiring.name).toBe('read')
    expect(writeWiring.name).toBe('write')
    const outside = join(tmpdir(), 'cohort-captain-outside.txt')
    await expect(readWiring.operations.readFile?.(outside)).rejects.toThrow(
      /outside the workspace sandbox/
    )
    await expect(writeWiring.operations.writeFile?.(outside, 'x')).rejects.toThrow(
      /outside the workspace sandbox/
    )
    await expect(writeWiring.operations.mkdir?.(outside)).rejects.toThrow(
      /outside the workspace sandbox/
    )
    await host.disposeAll()
    store.close()
  })

  it('rejects captain writes into the reserved .prime directory but allows reads (KTD6)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, fileWirings } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'hi')
    const [readWiring, writeWiring] = fileWirings
    const workspaceRoot = join(home, 'workspaces', a.workspace.uuid)
    const threadFile = join(workspaceRoot, '.prime', 'agent', 'thread.json')
    writeFileSync(threadFile, '[]')
    await expect(readWiring.operations.readFile?.(threadFile)).resolves.toBeInstanceOf(Buffer)
    await expect(writeWiring.operations.writeFile?.(threadFile, 'forged')).rejects.toThrow(
      /off-limits for writes/
    )
    await expect(
      writeWiring.operations.mkdir?.(join(workspaceRoot, '.prime', 'agent', 'evil'))
    ).rejects.toThrow(/off-limits for writes/)
    // Ordinary workspace writes still go through.
    await expect(
      writeWiring.operations.writeFile?.(join(workspaceRoot, 'notes.txt'), 'hello')
    ).resolves.toBeUndefined()
    expect(existsSync(join(workspaceRoot, 'notes.txt'))).toBe(true)
    await host.disposeAll()
    store.close()
  })

  it('appends only the user message up front and builds the assistant entry from stream events (#11)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule()
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'hi')
    expect(host.thread(a.workspace.uuid)).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hi' }
    ])
    await host.disposeAll()
    store.close()
  })

  it('captures a reply even when the SDK skips message_start (#16)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule({
      prompt: async (_text, emit) => {
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'streamed' } })
        emit({ type: 'agent_end' })
      }
    })
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'go')
    expect(host.thread(a.workspace.uuid)).toEqual([
      { role: 'user', text: 'go' },
      { role: 'assistant', text: 'streamed' }
    ])
    await host.disposeAll()
    store.close()
  })

  it('records one assistant entry per streamed message in a multi-message turn (#16)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module } = fakeModule({
      prompt: async (_text, emit) => {
        emit({ type: 'message_start' })
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'part one ' } })
        emit({ type: 'message_end' })
        emit({ type: 'message_start' })
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'part two' } })
        emit({ type: 'message_end' })
        emit({ type: 'agent_end' })
      }
    })
    const host = new CaptainHost(home, async () => module)
    await host.send(a.workspace.uuid, 'go')
    expect(host.thread(a.workspace.uuid)).toEqual([
      { role: 'user', text: 'go' },
      { role: 'assistant', text: 'part one ' },
      { role: 'assistant', text: 'part two' }
    ])
    await host.disposeAll()
    store.close()
  })

  it('marks a failed turn in the thread and on disk, and keeps bare user turns intact (#11)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const b = store.create('B')
    const { module } = fakeModule({
      prompt: async (text, emit) => {
        if (text === 'started') emit({ type: 'message_start' })
        throw new Error('boom')
      }
    })
    const host = new CaptainHost(home, async () => module)
    await expect(host.send(a.workspace.uuid, 'started')).rejects.toThrow('boom')
    const threadFile = join(home, 'workspaces', a.workspace.uuid, '.prime', 'agent', 'thread.json')
    expect(host.thread(a.workspace.uuid)).toEqual([
      { role: 'user', text: 'started' },
      { role: 'assistant', text: '(turn failed: boom)' }
    ])
    expect(JSON.parse(readFileSync(threadFile, 'utf8'))).toEqual([
      { role: 'user', text: 'started' },
      { role: 'assistant', text: '(turn failed: boom)' }
    ])
    // A turn that fails before any assistant message started keeps the user message.
    await expect(host.send(b.workspace.uuid, 'never started')).rejects.toThrow('boom')
    expect(host.thread(b.workspace.uuid)).toEqual([{ role: 'user', text: 'never started' }])
    await host.disposeAll()
    store.close()
  })

  it('serializes overlapping sends for one uuid so prompts never interleave (#9)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const firstStarted = Promise.withResolvers<void>()
    const secondStarted = Promise.withResolvers<void>()
    const firstGate = Promise.withResolvers<void>()
    const secondGate = Promise.withResolvers<void>()
    const { module, captured } = fakeModule({
      prompt: async (text) => {
        if (text === 'one') {
          firstStarted.resolve()
          await firstGate.promise
        } else {
          secondStarted.resolve()
          await secondGate.promise
        }
      }
    })
    const host = new CaptainHost(home, async () => module)
    const first = host.send(a.workspace.uuid, 'one')
    const second = host.send(a.workspace.uuid, 'two')
    await firstStarted.promise
    // The second prompt stays queued until the first turn settles.
    expect(captured[0].prompts).toEqual(['one'])
    firstGate.resolve()
    await secondStarted.promise
    expect(captured[0].prompts).toEqual(['one', 'two'])
    secondGate.resolve()
    await Promise.all([first, second])
    await host.disposeAll()
    store.close()
  })

  it('persists the user message before the prompt settles (#5)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const promptStarted = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const { module } = fakeModule({
      prompt: async (_text, emit) => {
        promptStarted.resolve()
        await gate.promise
        emit({ type: 'message_start' })
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done' } })
        emit({ type: 'agent_end' })
      }
    })
    const host = new CaptainHost(home, async () => module)
    const pending = host.send(a.workspace.uuid, 'early')
    const threadFile = join(home, 'workspaces', a.workspace.uuid, '.prime', 'agent', 'thread.json')
    await promptStarted.promise
    // Mid-turn: the user message is already durable, with no empty assistant placeholder.
    expect(JSON.parse(readFileSync(threadFile, 'utf8'))).toEqual([{ role: 'user', text: 'early' }])
    gate.resolve()
    await pending
    expect(host.thread(a.workspace.uuid)).toEqual([
      { role: 'user', text: 'early' },
      { role: 'assistant', text: 'done' }
    ])
    await host.disposeAll()
    store.close()
  })

  it('disposeAll persists in-flight threads before clearing entries (#5)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const promptStarted = Promise.withResolvers<void>()
    const neverSettles = Promise.withResolvers<void>()
    const { module } = fakeModule({
      prompt: async () => {
        promptStarted.resolve()
        await neverSettles.promise
      }
    })
    const host = new CaptainHost(home, async () => module)
    void host.send(a.workspace.uuid, 'mid-turn')
    const threadFile = join(home, 'workspaces', a.workspace.uuid, '.prime', 'agent', 'thread.json')
    await promptStarted.promise
    // Drop the pre-prompt write to prove disposeAll persists the thread itself.
    rmSync(threadFile)
    await host.disposeAll()
    expect(JSON.parse(readFileSync(threadFile, 'utf8'))).toEqual([
      { role: 'user', text: 'mid-turn' }
    ])
    store.close()
  })

  it('bash wrapper forwards stdout then stderr and passes the SDK timeout through (#19)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, bashWirings } = fakeModule()
    const runs: Array<{ command: string; timeoutMs?: number }> = []
    const host = new CaptainHost(home, async () => module, {
      boxRunner: (uuid) => async (command, options) => {
        expect(uuid).toBe(a.workspace.uuid)
        runs.push({ command, timeoutMs: options?.timeoutMs })
        return { exitCode: 0, stdout: 'out chunk', stderr: 'err chunk' }
      }
    })
    await host.send(a.workspace.uuid, 'list files')
    const chunks: string[] = []
    const outcome = await bashWirings[0].exec('ls /workspace', bashWirings[0].cwd, {
      onData: (data) => chunks.push(data.toString()),
      timeout: 1500
    })
    expect(chunks).toEqual(['out chunk', 'err chunk'])
    expect(runs).toEqual([{ command: 'ls /workspace', timeoutMs: 1500 }])
    expect(outcome).toEqual({ exitCode: 0 })
    await host.disposeAll()
    store.close()
  })

  it('bash wrapper rejects when the abort signal is or becomes aborted (#19)', async () => {
    const home = tempHome()
    const store = new WorkspaceStore(home)
    const a = store.create('A')
    const { module, bashWirings } = fakeModule()
    const neverSettles = Promise.withResolvers<void>()
    let started = 0
    const host = new CaptainHost(home, async () => module, {
      boxRunner: () => async () => {
        started += 1
        await neverSettles.promise
        return { exitCode: 0, stdout: '', stderr: '' }
      }
    })
    await host.send(a.workspace.uuid, 'x')
    // Already aborted: the runner is never invoked.
    const preAborted = new AbortController()
    preAborted.abort()
    await expect(
      bashWirings[0].exec('never', bashWirings[0].cwd, {
        onData: () => undefined,
        signal: preAborted.signal
      })
    ).rejects.toThrow(/aborted/)
    expect(started).toBe(0)
    // Aborting mid-run rejects the wrapper while the box command hangs.
    const controller = new AbortController()
    const pending = bashWirings[0].exec('slow', bashWirings[0].cwd, {
      onData: () => undefined,
      signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    expect(started).toBe(1)
    await host.disposeAll()
    store.close()
  })
})
