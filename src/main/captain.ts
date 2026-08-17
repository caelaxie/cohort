import {
  constants as fsConstants,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
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
}

export type CreateSessionResult = {
  session: PrimeSession
}

/** Runs one command inside a workspace's sandbox. */
export type BoxCommandRunner = (
  command: string,
  options?: { timeoutMs?: number }
) => Promise<{
  exitCode: number
  stdout: string
  stderr: string
}>
export type HostOptions = {
  /**
   * Per-uuid sandbox command runner (KTD5): its box-routed bash tool
   * shadows the builtin host bash by name, so commands never run on the
   * host while a runner is provided.
   */
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
          hooks: {
            onData: (data: Buffer) => void
            signal?: AbortSignal
            timeout?: number
          }
        ) => Promise<{ exitCode: number | null }>
      }
    }
  ) => object
  createReadToolDefinition: (
    cwd: string,
    options: {
      operations: {
        readFile: (absolutePath: string) => Promise<Buffer>
        access: (absolutePath: string) => Promise<void>
        detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>
      }
    }
  ) => object
  createWriteToolDefinition: (
    cwd: string,
    options: {
      operations: {
        writeFile: (absolutePath: string, content: string) => Promise<void>
        mkdir: (dir: string) => Promise<void>
      }
    }
  ) => object
  createEditToolDefinition: (
    cwd: string,
    options: {
      operations: {
        readFile: (absolutePath: string) => Promise<Buffer>
        writeFile: (absolutePath: string, content: string) => Promise<void>
        access: (absolutePath: string) => Promise<void>
      }
    }
  ) => object
  createGrepToolDefinition: (
    cwd: string,
    options: {
      operations: {
        isDirectory: (absolutePath: string) => Promise<boolean> | boolean
        readFile: (absolutePath: string) => Promise<string> | string
      }
    }
  ) => object
  createFindToolDefinition: (
    cwd: string,
    options: {
      operations: {
        exists: (absolutePath: string) => Promise<boolean> | boolean
        glob: (
          pattern: string,
          searchPath: string,
          options: { ignore: string[]; limit: number }
        ) => Promise<string[]> | string[]
      }
    }
  ) => object
  createLsToolDefinition: (
    cwd: string,
    options: {
      operations: {
        exists: (absolutePath: string) => Promise<boolean> | boolean
        stat: (
          absolutePath: string
        ) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean }
        readdir: (absolutePath: string) => Promise<string[]> | string[]
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

/**
 * Resolves a path to its real on-disk location, following symlinks where
 * they exist. A missing tail (a file about to be created) falls back to
 * the deepest existing ancestor plus the remaining segments, so symlinked
 * ancestors cannot smuggle writes outside the workspace.
 */
function resolveRealPath(absolutePath: string): string {
  try {
    return realpathSync(absolutePath)
  } catch {
    const parent = dirname(absolutePath)
    if (parent === absolutePath) return absolutePath
    return join(resolveRealPath(parent), basename(absolutePath))
  }
}

/**
 * Guards one captain file operation (R4/R5): the SDK default tools run in
 * this process and pass absolute paths straight to fs, so every operation
 * is re-resolved and rejected when it lands outside the workspace.
 * Writes are additionally barred from the reserved `.prime` directory
 * (KTD6): main's thread persistence and session manager are the only
 * legitimate writers there. Reads of `.prime` stay allowed.
 */
function confinedPath(rawPath: string, realRoot: string, kind: 'read' | 'write'): string {
  const realPath = resolveRealPath(resolve(rawPath))
  if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
    throw new Error(`path is outside the workspace sandbox: ${rawPath}`)
  }
  if (kind === 'write') {
    const reserved = join(realRoot, PRIME_RESERVED_DIR)
    if (realPath === reserved || realPath.startsWith(reserved + sep)) {
      throw new Error(
        `the reserved ${PRIME_RESERVED_DIR} directory is off-limits for writes: ${rawPath}`
      )
    }
  }
  return realPath
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

/** Directories the find tool never walks, mirroring its ignore list. */
const GLOB_IGNORED_DIRECTORIES: Record<string, true> = { node_modules: true, '.git': true }

/** Translates a shell-style glob into a RegExp over posix-style paths. */
function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        while (pattern[i + 1] === '*') i++
        if (pattern[i + 1] === '/') {
          i++
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else if (char === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) {
        source += '\\['
      } else {
        const body = pattern.slice(i + 1, end)
        source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`
        i = end
      }
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/**
 * Glob-matches files under searchRoot in-process, so the find tool cannot
 * walk outside the workspace: the SDK default delegates to an fd child
 * process with the raw, unconfined search path. A pattern without a
 * separator matches basenames (fd's default); one with separators matches
 * the full relative path with an implicit leading double-star prefix.
 */
async function globWithin(
  searchRoot: string,
  pattern: string,
  options: { ignore: string[]; limit: number }
): Promise<string[]> {
  const limit = Math.max(1, options.limit)
  const fullPathPattern = pattern.includes('/')
  const matcher = globToRegExp(
    fullPathPattern && !pattern.startsWith('**/') ? `**/${pattern}` : pattern
  )
  const results: string[] = []
  const walk = async (dir: string, relative: string): Promise<void> => {
    if (results.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= limit) return
      if (GLOB_IGNORED_DIRECTORIES[entry.name]) continue
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (matcher.test(fullPathPattern ? entryRelative : entry.name)) {
        results.push(join(dir, entry.name))
      }
      if (entry.isDirectory()) await walk(join(dir, entry.name), entryRelative)
    }
  }
  await walk(searchRoot, '')
  return results
}

/**
 * Builds read/write/edit/grep/find/ls definitions whose filesystem
 * operations are confined to one workspace. Passed through customTools,
 * they shadow the SDK built-ins by name (the registry applies custom
 * tools after its own definitions), the same mechanism the box bash uses.
 */
function confinedFileTools(module: PrimeModule, workspaceRoot: string): object[] {
  const realRoot = resolveRealPath(workspaceRoot)
  const guardRead = (rawPath: string): string => confinedPath(rawPath, realRoot, 'read')
  const guardWrite = (rawPath: string): string => confinedPath(rawPath, realRoot, 'write')
  const exists = async (rawPath: string): Promise<boolean> => {
    const guarded = guardRead(rawPath)
    try {
      await access(guarded)
      return true
    } catch {
      return false
    }
  }
  return [
    module.createReadToolDefinition(workspaceRoot, {
      operations: {
        readFile: async (filePath) => readFile(guardRead(filePath)),
        access: async (filePath) => access(guardRead(filePath)),
        detectImageMimeType: async (filePath) =>
          IMAGE_MIME_TYPES[extname(guardRead(filePath)).toLowerCase()] ?? null
      }
    }),
    module.createWriteToolDefinition(workspaceRoot, {
      operations: {
        writeFile: async (filePath, content) => writeFile(guardWrite(filePath), content, 'utf-8'),
        mkdir: async (dir) => {
          await mkdir(guardWrite(dir), { recursive: true })
        }
      }
    }),
    module.createEditToolDefinition(workspaceRoot, {
      operations: {
        readFile: async (filePath) => readFile(guardRead(filePath)),
        writeFile: async (filePath, content) => writeFile(guardWrite(filePath), content, 'utf-8'),
        access: async (filePath) => access(guardRead(filePath), fsConstants.R_OK | fsConstants.W_OK)
      }
    }),
    module.createGrepToolDefinition(workspaceRoot, {
      operations: {
        isDirectory: async (searchPath) => (await stat(guardRead(searchPath))).isDirectory(),
        readFile: async (filePath) => readFile(guardRead(filePath), 'utf-8')
      }
    }),
    module.createFindToolDefinition(workspaceRoot, {
      operations: {
        exists,
        glob: async (pattern, searchPath, options) =>
          globWithin(guardRead(searchPath), pattern, options)
      }
    }),
    module.createLsToolDefinition(workspaceRoot, {
      operations: {
        exists,
        stat: async (filePath) => stat(guardRead(filePath)),
        readdir: async (dirPath) => readdir(guardRead(dirPath))
      }
    })
  ]
}

const CAPTAIN_SYSTEM_PROMPT = [
  'You are the captain of this Cohort workspace.',
  'You see and change files only inside this workspace.',
  'Commands run inside this workspace sandbox; never touch anything outside it.',
  'The reserved .prime directory is off-limits for writes.',
  'Be concise and direct with the owner.'
].join(' ')

type HostEntry = {
  session: PrimeSession | null
  create: Promise<void> | null
  working: boolean
  thread: ThreadMessage[] | null
  threadError?: string
  unsubscribe: (() => void) | null
  /** Serializes prompts per uuid: two cohort:send calls never interleave. */
  sendQueue: Promise<void>
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
  private readonly workingListeners: Array<(uuid: string, working: boolean) => void> = []
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

  onWorkingChange(listener: (uuid: string, working: boolean) => void): void {
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
    const turn = async (): Promise<void> => {
      // Only the user message lands eagerly: each assistant entry is appended
      // lazily on the first streamed event of its message.
      entry.thread = [...(entry.thread ?? []), { role: 'user', text }]
      // The in-flight user message must survive a quit mid-turn.
      this.persistThread(uuid)
      this.setWorking(uuid, true)
      try {
        await entry.session?.prompt(text)
      } catch (cause) {
        this.markFailedTurn(entry, cause)
        throw cause
      } finally {
        this.setWorking(uuid, false)
        this.persistThread(uuid)
      }
    }
    // Prompts for one uuid run strictly serially, in send order.
    const chained = entry.sendQueue.then(turn)
    entry.sendQueue = chained.catch(() => undefined)
    await chained
  }

  /**
   * Marks a rejected prompt in the thread: an assistant entry that started
   * but never received text becomes the failure marker; a turn that failed
   * before any assistant entry started leaves the user message as-is.
   */
  private markFailedTurn(entry: HostEntry, cause: unknown): void {
    const thread = entry.thread ?? []
    const last = thread[thread.length - 1]
    if (last?.role === 'assistant' && last.text === '') {
      thread[thread.length - 1] = {
        role: 'assistant',
        text: `(turn failed: ${cause instanceof Error ? cause.message : String(cause)})`
      }
    }
    this.emitThreadSoon()
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
    } catch (cause) {
      // History persistence stays best-effort; the live thread still works.
      console.error(
        `cohort: thread persist failed for ${uuid}: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }

  /**
   * Loads the persisted thread for a uuid without opening a live session.
   * Returns null when no history exists (AE7); a load failure sets
   * threadError so the renderer can distinguish corruption from absence.
   */
  async loadThread(uuid: string): Promise<ThreadMessage[] | null> {
    assertSafeUuid(uuid)
    const entry = this.ensureEntry(uuid)
    if (entry.thread) return entry.thread
    const file = this.threadFile(uuid)
    if (!file) return null
    try {
      const raw = readFileSync(file, 'utf8')
      JSON.parse(raw)
      entry.thread = this.parseThread(raw)
    } catch (cause) {
      entry.threadError = `captain history could not be read: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
      entry.thread = null
      return null
    }
    if (entry.thread.length === 0) {
      // The file exists but holds no usable messages.
      entry.threadError = 'captain history is unreadable'
    }
    return entry.thread
  }

  threadError(uuid: string): string | undefined {
    return this.entries.get(uuid)?.threadError
  }

  async disposeAll(): Promise<void> {
    this.disposed = true
    if (this.threadEmitTimer) {
      clearTimeout(this.threadEmitTimer)
      this.threadEmitTimer = null
    }
    // A quit mid-turn must not lose in-flight threads: persist every entry
    // before disposing sessions and clearing the map.
    for (const [uuid, entry] of this.entries) {
      if (entry.thread) this.persistThread(uuid)
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
      entry = {
        session: null,
        create: null,
        working: false,
        thread: null,
        unsubscribe: null,
        sendQueue: Promise.resolve()
      }
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
    // File tools are confined to this workspace (R4/R5): the SDK defaults
    // run in this process against the host filesystem with no cwd checks.
    // Every custom tool shadows its builtin namesake because the SDK
    // registry applies custom tools after its own definitions.
    const customTools: object[] = [...confinedFileTools(module, cwd)]
    if (this.options.boxRunner) {
      const runInBox = this.options.boxRunner(uuid)
      // The box-routed bash carries the builtin name and shadows the host
      // bash (KTD5); excludeTools cannot be used to hide the host bash
      // because it drops custom tools by name too.
      customTools.push(
        module.createBashToolDefinition(cwd, {
          operations: {
            exec: async (command, _cwdArg, hooks) => {
              const { onData, signal, timeout } = hooks
              if (signal?.aborted) throw new Error('bash command aborted')
              const timeoutMs = typeof timeout === 'number' ? timeout : undefined
              const running = runInBox(command, timeoutMs === undefined ? undefined : { timeoutMs })
              let detach: () => void = () => undefined
              const aborted = new Promise<never>((_, reject) => {
                if (!signal) return
                const onAbort = (): void => reject(new Error('bash command aborted'))
                signal.addEventListener('abort', onAbort, { once: true })
                detach = () => signal.removeEventListener('abort', onAbort)
              })
              try {
                const result = await Promise.race([running, aborted])
                if (result.stdout) onData(Buffer.from(result.stdout))
                if (result.stderr) onData(Buffer.from(result.stderr))
                return { exitCode: result.exitCode }
              } finally {
                detach()
              }
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
        customTools
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
    // Each assistant message opens a fresh entry; user messages are appended
    // by send() and never arrive as streamed events.
    if (event.type === 'message_start') {
      entry.thread = [...(entry.thread ?? []), { role: 'assistant', text: '' }]
      this.emitThreadSoon()
      return
    }
    const message = event.assistantMessageEvent
    if (
      event.type === 'message_update' &&
      message?.type === 'text_delta' &&
      typeof message.delta === 'string'
    ) {
      const thread = (entry.thread ??= [])
      let last = thread[thread.length - 1]
      if (!last || last.role !== 'assistant') {
        // SDKs that skip message_start still get their reply captured.
        last = { role: 'assistant', text: '' }
        thread.push(last)
      }
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
    for (const listener of this.workingListeners) listener(uuid, working)
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
