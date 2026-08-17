import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRIME_RESERVED_DIR, assertSafeUuid, workspaceDir } from './paths'
import { WorkspaceStore } from './workspaces'
import type { ThreadMessageDto } from '../shared/workspace'

export type PrimeSessionEvent = {
  type: string
  assistantMessageEvent?: { type?: string; delta?: string }
  [key: string]: unknown
}

export type PrimeSession = {
  prompt: (text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }) => Promise<void>
  subscribe: (listener: (event: PrimeSessionEvent) => void) => () => void
  dispose: () => void
}

export type ThreadMessage = ThreadMessageDto

export type CreateSessionOptions = {
  cwd: string
  agentDir: string
  sessionManager: object
  resourceLoader?: object
  modelRuntime?: object
  customTools?: object[]
  excludeTools?: string[]
}

export type CreateSessionResult = {
  session: PrimeSession
}

/** Runs one command inside a workspace's sandbox. */
export type BoxCommandRunner = (command: string) => Promise<{
  exitCode: number
  stdout: string
  stderr: string
}>

export type HostOptions = {
  /** Per-uuid sandbox command runner (KTD5). Absent disables commands. */
  boxRunner?: (uuid: string) => BoxCommandRunner
  /** Roster membership check from the long-lived store; defaults to opening one per call. */
  isKnownWorkspace?: (uuid: string) => boolean
  /** Optional model pin; defaults to the owner's configured model. */
  model?: object
}

type ResourceLoaderInstance = {
  reload: () => Promise<void>
}

/** Structural view of the loaded SDK module (KTD1: in-process only). */
export type PrimeModule = {
  createAgentSession: (options: CreateSessionOptions) => Promise<CreateSessionResult>
  SessionManager: {
    continueRecent: (cwd: string, sessionDir: string) => object
  }
  ModelRuntime: { create: (options?: { authPath?: string }) => Promise<object> }
  DefaultResourceLoader: new (options: Record<string, unknown>) => ResourceLoaderInstance
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
  ) => object
}

type PrimeModuleLoader = () => Promise<PrimeModule>

export class PrimeSdkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PrimeSdkError'
  }
}

// Lazy import: the SDK must stay external to the main bundle and load on
// first use, mirroring the established `live-box.ts` native-module pattern.
const loadPrimeModule: PrimeModuleLoader = async () =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PrimeModule

export function primeWorkspaceAgentDir(home: string, uuid: string): string {
  return join(workspaceDir(home, uuid), PRIME_RESERVED_DIR, 'agent')
}

function primeWorkspaceSessionsDir(home: string, uuid: string): string {
  return join(primeWorkspaceAgentDir(home, uuid), 'sessions')
}

const CAPTAIN_SYSTEM_PROMPT = [
  'You are the captain of this Cohort workspace.',
  'You see and change files only inside this workspace.',
  'Commands run inside this workspace sandbox; never touch anything outside it.',
  'Be concise and direct with the owner.'
].join(' ')

type HostEntry = {
  session: PrimeSession | null
  create: Promise<void> | null
  working: boolean
  thread: ThreadMessage[] | null
  unsubscribe: (() => void) | null
}

/**
 * One Prime session per workspace uuid, pinned to that workspace folder
 * (KTD2): cwd, agentDir, and session files never leave the workspace's
 * reserved `.prime` directory. The SDK module is injectable for tests.
 */
export class CaptainHost {
  private readonly entries = new Map<string, HostEntry>()
  private module: PrimeModule | null = null
  private moduleLoad: Promise<PrimeModule> | null = null
  private readonly workingListeners: Array<() => void> = []
  private readonly threadListeners: Array<() => void> = []
  private threadEmitTimer: ReturnType<typeof setTimeout> | null = null
  private readonly fileListeners: Array<(uuid: string) => void> = []
  private disposed = false
  private modelRuntimePromise: Promise<object> | null = null

  constructor(
    private readonly home: string,
    private readonly loader: PrimeModuleLoader = loadPrimeModule,
    private readonly options: HostOptions = {}
  ) {}

  onWorkingChange(listener: () => void): void {
    this.workingListeners.push(listener)
  }

  onFileChange(listener: (uuid: string) => void): void {
    this.fileListeners.push(listener)
  }

  onThreadChange(listener: () => void): void {
    this.threadListeners.push(listener)
  }

  isWorking(uuid: string): boolean {
    return this.entries.get(uuid)?.working ?? false
  }

  thread(uuid: string): ThreadMessage[] | null {
    return this.entries.get(uuid)?.thread ?? null
  }

  /** Sends a message to that workspace's captain, opening its session on demand. */
  async send(uuid: string, text: string): Promise<void> {
    const entry = await this.entryFor(uuid)
    this.assertLive()
    entry.thread = [
      ...(entry.thread ?? []),
      { role: 'user', text },
      { role: 'assistant', text: '' }
    ]
    this.setWorking(uuid, true)
    try {
      await entry.session?.prompt(text)
    } finally {
      this.setWorking(uuid, false)
      this.persistThread(uuid)
    }
  }

  /** Where the persisted thread for a uuid lives, or null for an unsafe uuid. */
  threadFile(uuid: string): string | null {
    try {
      return join(primeWorkspaceAgentDir(this.home, uuid), 'thread.json')
    } catch {
      return null
    }
  }

  private persistThread(uuid: string): void {
    const entry = this.entries.get(uuid)
    if (!entry?.thread) return
    const file = this.threadFile(uuid)
    if (!file) return
    try {
      writeFileSync(file, JSON.stringify(entry.thread))
    } catch {
      // History persistence is best-effort; the live thread still works.
    }
  }

  /**
   * Loads the persisted thread for a uuid without opening a live session.
   * Returns null when no history exists (AE7).
   */
  async loadThread(uuid: string): Promise<ThreadMessage[] | null> {
    assertSafeUuid(uuid)
    const entry = this.ensureEntry(uuid)
    if (entry.thread) return entry.thread
    const file = this.threadFile(uuid)
    if (!file || !existsSync(file)) return null
    try {
      entry.thread = this.parseThread(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
    return entry.thread
  }

  async disposeAll(): Promise<void> {
    this.disposed = true
    if (this.threadEmitTimer) {
      clearTimeout(this.threadEmitTimer)
      this.threadEmitTimer = null
    }
    const entries = Array.from(this.entries.values())
    await Promise.all(
      entries.map(async (entry) => {
        entry.unsubscribe?.()
        if (entry.create) await entry.create.catch(() => undefined)
        entry.session?.dispose()
        entry.session = null
      })
    )
    this.entries.clear()
  }

  private assertLive(): void {
    if (this.disposed) throw new PrimeSdkError('captain host is disposed')
  }

  private ensureEntry(uuid: string): HostEntry {
    let entry = this.entries.get(uuid)
    if (!entry) {
      entry = { session: null, create: null, working: false, thread: null, unsubscribe: null }
      this.entries.set(uuid, entry)
    }
    return entry
  }

  private async entryFor(uuid: string): Promise<HostEntry> {
    this.assertLive()
    if (!this.isKnownWorkspace(uuid)) throw new Error(`unknown workspace: ${uuid}`)
    const entry = this.ensureEntry(uuid)
    if (entry.create) {
      await entry.create
      return entry
    }
    entry.create = this.createSession(uuid)
    try {
      await entry.create
    } catch (cause) {
      entry.create = null
      throw cause
    }
    return entry
  }

  private isKnownWorkspace(uuid: string): boolean {
    if (this.options.isKnownWorkspace) return this.options.isKnownWorkspace(uuid)
    const store = new WorkspaceStore(this.home)
    try {
      return store.list().some((item) => item.uuid === uuid)
    } finally {
      store.close()
    }
  }

  private async createSession(uuid: string): Promise<void> {
    const module = await this.loadModule()
    const cwd = workspaceDir(this.home, uuid)
    const agentDir = primeWorkspaceAgentDir(this.home, uuid)
    const sessionsDir = primeWorkspaceSessionsDir(this.home, uuid)
    mkdirSync(sessionsDir, { recursive: true })
    const sessionManager = module.SessionManager.continueRecent(cwd, sessionsDir)
    // Shared owner auth (KTD3); prompts, sessions, and tools stay per-workspace.
    const modelRuntime = await this.sharedModelRuntime(module)
    // Resource discovery confined to this workspace (R4): no host skills,
    // extensions, or ancestor context files leak into the captain.
    const resourceLoader = new module.DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      systemPromptOverride: () => CAPTAIN_SYSTEM_PROMPT,
      agentsFilesOverride: () => ({ agentsFiles: [] })
    })
    await resourceLoader.reload()
    const customTools: object[] = []
    if (this.options.boxRunner) {
      const runInBox = this.options.boxRunner(uuid)
      customTools.push(
        module.createBashToolDefinition(cwd, {
          operations: {
            exec: async (command, _cwdArg, hooks) => {
              const result = await runInBox(command)
              if (result.stdout) hooks.onData(Buffer.from(result.stdout))
              return { exitCode: result.exitCode }
            }
          }
        })
      )
    }
    let result: CreateSessionResult
    try {
      result = await module.createAgentSession({
        ...(this.options.model ? { model: this.options.model } : {}),
        cwd,
        agentDir,
        sessionManager,
        resourceLoader,
        modelRuntime,
        customTools,
        // Host bash is never exposed: commands run in the workspace box (KTD5).
        excludeTools: ['bash']
      })
    } catch (cause) {
      throw new PrimeSdkError('Prime session could not be created', { cause })
    }
    const entry = this.ensureEntry(uuid)
    entry.session = result.session
    entry.unsubscribe = result.session.subscribe((event) => this.onEvent(uuid, event))
  }

  private async sharedModelRuntime(module: PrimeModule): Promise<object> {
    if (!this.modelRuntimePromise) {
      this.modelRuntimePromise = module.ModelRuntime.create().catch((cause) => {
        this.modelRuntimePromise = null
        throw new PrimeSdkError('owner model credentials unavailable', { cause })
      })
    }
    return this.modelRuntimePromise
  }

  private onEvent(uuid: string, event: PrimeSessionEvent): void {
    const entry = this.entries.get(uuid)
    if (!entry) return
    if (event.type === 'agent_end') {
      // The captain may have written files during the turn; push a refresh.
      for (const listener of this.fileListeners) listener(uuid)
      return
    }
    if (!entry.thread || entry.thread.length === 0) return
    const last = entry.thread[entry.thread.length - 1]
    const message = event.assistantMessageEvent
    if (
      event.type === 'message_update' &&
      message?.type === 'text_delta' &&
      typeof message.delta === 'string' &&
      last.role === 'assistant'
    ) {
      last.text += message.delta
      this.emitThreadSoon()
    }
  }

  private emitThreadSoon(): void {
    if (this.threadEmitTimer) return
    this.threadEmitTimer = setTimeout(() => {
      this.threadEmitTimer = null
      for (const listener of this.threadListeners) listener()
    }, 100)
  }

  private parseThread(raw: string): ThreadMessage[] {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (item): item is ThreadMessage =>
          typeof item === 'object' &&
          item !== null &&
          ((item as { role?: unknown }).role === 'assistant' ||
            (item as { role?: unknown }).role === 'user') &&
          typeof (item as { text?: unknown }).text === 'string'
      )
    } catch {
      return []
    }
  }

  private setWorking(uuid: string, working: boolean): void {
    const entry = this.entries.get(uuid)
    if (!entry || entry.working === working) return
    entry.working = working
    for (const listener of this.workingListeners) listener()
  }

  private async loadModule(): Promise<PrimeModule> {
    if (this.module) return this.module
    if (!this.moduleLoad) {
      this.moduleLoad = this.loader()
    }
    try {
      this.module = await this.moduleLoad
      return this.module
    } catch (cause) {
      this.moduleLoad = null
      throw new PrimeSdkError('Prime SDK failed to load in the main process', { cause })
    }
  }
}
