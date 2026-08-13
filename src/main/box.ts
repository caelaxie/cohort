import { workspaceDir } from './paths'

export type BoxStatus = 'none' | 'starting' | 'running' | 'error'

export type BoxState = {
  status: BoxStatus
  error?: string
  uuid: string | null
}

export type RunningBox = {
  stop: () => Promise<void>
}

export type BoxStarter = (input: {
  hostPath: string
  guestPath: string
}) => Promise<RunningBox>

export class BoxManager {
  private queue: Promise<void> = Promise.resolve()
  private running: RunningBox | null = null
  private generation = 0
  state: BoxState = { status: 'none', uuid: null }

  constructor(
    private readonly home: string,
    private readonly startBox: BoxStarter,
    private readonly onChange: (state: BoxState) => void
  ) {}

  setCurrent(uuid: string | null): void {
    const gen = ++this.generation
    this.state = uuid
      ? { status: 'starting', uuid }
      : { status: 'none', uuid: null }
    this.onChange(this.state)
    this.queue = this.queue.then(() => this.remount(uuid, gen)).catch((error) => {
      if (gen !== this.generation) return
      this.state = {
        status: uuid ? 'error' : 'none',
        uuid,
        error: error instanceof Error ? error.message : 'box remount failed'
      }
      this.onChange(this.state)
    })
  }

  async quit(): Promise<void> {
    await this.queue
    this.generation += 1
    await this.stopRunning()
    this.state = { status: 'none', uuid: null }
    this.onChange(this.state)
  }

  private async remount(uuid: string | null, gen: number): Promise<void> {
    await this.stopRunning()
    if (gen !== this.generation) return
    if (!uuid) {
      this.state = { status: 'none', uuid: null }
      this.onChange(this.state)
      return
    }
    const hostPath = workspaceDir(this.home, uuid)
    this.running = await this.startBox({ hostPath, guestPath: '/workspace' })
    if (gen !== this.generation) {
      await this.stopRunning()
      return
    }
    this.state = { status: 'running', uuid }
    this.onChange(this.state)
  }

  private async stopRunning(): Promise<void> {
    const box = this.running
    this.running = null
    if (box) {
      await box.stop()
    }
  }
}
