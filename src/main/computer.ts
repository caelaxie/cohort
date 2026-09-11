import { parseApprovalAsk, type ApprovalAsk } from '../shared/approval'
import { SHARED_PROFILE, type ComputerResult, type ComputerStatus } from '../shared/computer'
import type { ApprovalStore } from './approval'

export type BrowserDriver = {
  act(ask: ApprovalAsk, signal: AbortSignal): Promise<unknown> | unknown
  dispose(): void
}

export type ComputerOptions = {
  readonly approvals: ApprovalStore
  readonly driver?: BrowserDriver
}

export function sharedDriver(): BrowserDriver {
  let live = true
  return {
    act(_ask, signal) {
      if (!live || signal.aborted) {
        throw new Error('stopped')
      }
      return { ok: true }
    },
    dispose() {
      live = false
    }
  }
}

export class Computer {
  private readonly approvals: ApprovalStore
  private readonly driver: BrowserDriver
  private readonly workers = new Set<AbortController>()
  private live = true

  constructor(options: ComputerOptions) {
    this.approvals = options.approvals
    this.driver = options.driver ?? sharedDriver()
  }

  status(): ComputerStatus {
    return this.live ? { kind: 'ready', profile: SHARED_PROFILE } : { kind: 'stopped' }
  }

  async use(input: unknown): Promise<ComputerResult> {
    if (!this.live) {
      return { kind: 'unavailable' }
    }
    const ask = parseApprovalAsk(input)
    const worker = new AbortController()
    this.workers.add(worker)
    try {
      const result = await this.approvals.gated(ask, () => {
        if (!this.live || worker.signal.aborted) {
          throw new Error('stopped')
        }
        return this.driver.act(ask, worker.signal)
      })
      if (result.kind === 'denied') {
        return { kind: 'denied' }
      }
      return { kind: 'done', value: result.value }
    } catch (reason) {
      if (!this.live || worker.signal.aborted) {
        return { kind: 'unavailable' }
      }
      throw reason
    } finally {
      this.workers.delete(worker)
    }
  }

  stop(): void {
    if (!this.live) {
      return
    }
    this.live = false
    for (const worker of this.workers) {
      worker.abort()
    }
    this.workers.clear()
    this.driver.dispose()
  }
}
