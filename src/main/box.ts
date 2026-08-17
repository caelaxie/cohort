import { workspaceDir } from './paths'

export type BoxStatus = 'none' | 'starting' | 'running' | 'error'

export type BoxState = {
  status: BoxStatus
  error?: string
  uuid: string | null
}

export type RunningBox = {
  stop: () => Promise<void>
  /** Best-effort sandbox command execution; absent when unsupported. */
  exec?: (command: string) => Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }>
}

export type BoxStarter = (input: { hostPath: string; guestPath: string }) => Promise<RunningBox>

type ManagedBox = {
  uuid: string
  status: BoxStatus
  error?: string
  box: RunningBox | null
  generation: number
  queue: Promise<void>
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Multi-live sandbox registry (KTD4): the current workspace always has a box,
 * and a workspace whose captain is mid-work keeps its box after a switch.
 * Idle non-current boxes stop; per-uuid operations are serialized.
 */
export class BoxManager {
  private readonly boxes = new Map<string, ManagedBox>()
  private currentUuid: string | null = null
  private readonly working = new Set<string>()
  state: BoxState = { status: 'none', uuid: null }

  constructor(
    private readonly home: string,
    private readonly startBox: BoxStarter,
    private readonly onChange: () => void
  ) {}

  setCurrent(uuid: string | null): void {
    const previous = this.currentUuid
    this.currentUuid = uuid
    if (previous && previous !== uuid && !this.working.has(previous)) {
      this.stopBox(previous)
    }
    if (uuid) {
      this.ensureBox(uuid)
      return
    }
    this.publish()
  }

  setWorking(uuid: string, working: boolean): void {
    if (working) {
      this.working.add(uuid)
      this.ensureBox(uuid)
      return
    }
    this.working.delete(uuid)
    if (uuid !== this.currentUuid) {
      this.stopBox(uuid)
      return
    }
    this.publish()
  }

  liveStates(): BoxState[] {
    return Array.from(this.boxes.values(), (managed) => ({
      status: managed.status,
      error: managed.error,
      uuid: managed.uuid
    }))
  }

  async settle(): Promise<void> {
    await Promise.all(Array.from(this.boxes.values(), (managed) => managed.queue))
  }

  /** Resolves the running box for a uuid, waiting while it starts (AE10). */
  async waitForRunning(uuid: string, timeoutMs = 120_000): Promise<RunningBox> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const managed = this.boxes.get(uuid)
      if (managed?.box && managed.status === 'running') return managed.box
      if (managed?.status === 'error') {
        throw new Error(managed.error ?? `box for ${uuid} failed to start`)
      }
      if (Date.now() >= deadline) {
        throw new Error(`box for ${uuid} is not running`)
      }
      if (!managed) {
        // A working captain is entitled to its box: start it instead of polling blindly.
        this.ensureBox(uuid)
        continue
      }
      // The per-uuid queue settles exactly when the pending start settles; the
      // tick keeps the deadline above enforceable when the start hangs.
      const { promise: tick, resolve } = Promise.withResolvers<void>()
      const timer = setTimeout(resolve, 1000)
      await Promise.race([managed.queue.catch(() => undefined), tick])
      clearTimeout(timer)
    }
  }

  async quit(): Promise<string[]> {
    await this.settle()
    const entries = Array.from(this.boxes.values())
    for (const managed of entries) {
      managed.generation += 1
      managed.status = 'none'
      managed.error = undefined
    }
    const stops = await Promise.allSettled(
      entries.map(async (managed) => {
        const box = managed.box
        managed.box = null
        if (box) await box.stop()
      })
    )
    const errors = stops
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => message(result.reason, 'box stop failed'))
    this.boxes.clear()
    this.working.clear()
    this.currentUuid = null
    this.state = { status: 'none', uuid: null }
    this.onChange()
    return errors
  }

  private ensureBox(uuid: string): void {
    const existing = this.boxes.get(uuid)
    if (existing && (existing.status === 'starting' || existing.status === 'running')) return
    this.beginStart(uuid)
  }

  private beginStart(uuid: string): void {
    const managed =
      this.boxes.get(uuid) ??
      ({ uuid, status: 'none', box: null, generation: 0, queue: Promise.resolve() } as ManagedBox)
    const gen = ++managed.generation
    managed.status = 'starting'
    managed.error = undefined
    this.boxes.set(uuid, managed)
    managed.queue = managed.queue
      .then(() => this.launch(managed, gen))
      .catch((error) => {
        if (this.boxes.get(uuid) !== managed || gen !== managed.generation) return
        managed.status = 'error'
        managed.error = message(error, 'box start failed')
        this.publish()
      })
    this.publish()
  }

  private async launch(managed: ManagedBox, gen: number): Promise<void> {
    const previous = managed.box
    managed.box = null
    if (previous) await previous.stop()
    if (this.boxes.get(managed.uuid) !== managed || gen !== managed.generation) return
    const hostPath = workspaceDir(this.home, managed.uuid)
    const box = await this.startBox({ hostPath, guestPath: '/workspace' })
    if (this.boxes.get(managed.uuid) !== managed || gen !== managed.generation) {
      await box.stop()
      return
    }
    managed.box = box
    managed.status = 'running'
    this.publish()
  }

  private stopBox(uuid: string): void {
    const managed = this.boxes.get(uuid)
    if (!managed) return
    const gen = ++managed.generation
    managed.status = 'none'
    managed.error = undefined
    managed.queue = managed.queue
      .then(async () => {
        const box = managed.box
        managed.box = null
        if (box) await box.stop()
      })
      .catch((error) => {
        console.error(`cohort: box stop failed for ${uuid}: ${message(error, 'box stop failed')}`)
      })
      .then(() => {
        if (this.boxes.get(uuid) !== managed || gen !== managed.generation) return
        this.boxes.delete(uuid)
        this.publish()
      })
    this.publish()
  }

  private publish(): void {
    const uuid = this.currentUuid
    if (!uuid) {
      this.state = { status: 'none', uuid: null }
    } else {
      const managed = this.boxes.get(uuid)
      this.state = managed
        ? { status: managed.status, error: managed.error, uuid }
        : { status: 'none', uuid }
    }
    this.onChange()
  }
}
