import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { parseBotId, type BotId } from '../shared/roster'
import {
  parseActionClass,
  parseApprovalAsk,
  parseApprovalDecision,
  parseApprovalId,
  parseAuditId,
  type ApprovalAudit,
  type ApprovalDecision,
  type ApprovalVerdict,
  type Approvals,
  type DecideResult,
  type PendingApproval
} from '../shared/approval'
import { openApprovalDb, type ApprovalDb } from './db'
import { approvalAudit, pendingApprovals } from './schema'

export type GatedResult<T> =
  | { readonly kind: 'approved'; readonly request: PendingApproval; readonly value: T }
  | { readonly kind: 'denied'; readonly request: PendingApproval }

export type ApprovalOptions = {
  readonly home: string
  readonly known: (id: BotId) => boolean
  readonly now?: () => number
  readonly id?: () => string
  readonly onChange?: () => void
}

export class ApprovalStore {
  private readonly db: ApprovalDb
  private readonly known: (id: BotId) => boolean
  private readonly now: () => number
  private readonly id: () => string
  private readonly onChange?: () => void
  private readonly waiters = new Map<string, (verdict: ApprovalVerdict) => void>()

  constructor(options: ApprovalOptions) {
    this.db = openApprovalDb(options.home)
    this.known = options.known
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
    this.onChange = options.onChange
  }

  close(): void {
    for (const request of this.readPending()) {
      this.finish(request, 'denied')
    }
    this.db.$client.close()
  }

  snapshot(): Approvals {
    return { pending: this.readPending(), audit: this.readAudit() }
  }

  // Tool runners must call gated() (or require(), then run only on approved).
  async require(input: unknown): Promise<ApprovalVerdict> {
    const ask = parseApprovalAsk(input)
    if (!this.known(ask.botId)) {
      throw new Error('unknown bot')
    }
    const request: PendingApproval = {
      id: parseApprovalId(this.id()),
      botId: ask.botId,
      action: ask.action,
      summary: ask.summary,
      payload: ask.payload,
      createdAt: this.now()
    }
    this.db
      .insert(pendingApprovals)
      .values({
        id: request.id,
        botId: request.botId,
        action: request.action,
        summary: request.summary,
        payload: request.payload,
        createdAt: request.createdAt
      })
      .run()
    const verdict = this.wait(request.id)
    this.onChange?.()
    return verdict
  }

  async gated<T>(input: unknown, run: () => T | Promise<T>): Promise<GatedResult<T>> {
    const verdict = await this.require(input)
    if (verdict.kind !== 'approved') {
      return verdict
    }
    return { kind: 'approved', request: verdict.request, value: await run() }
  }

  approve(id: unknown): DecideResult {
    return this.decide(id, 'approved')
  }

  deny(id: unknown): DecideResult {
    return this.decide(id, 'denied')
  }

  denyAll(): Approvals {
    const pending = this.readPending()
    if (pending.length === 0) {
      return this.snapshot()
    }
    for (const request of pending) {
      this.finish(request, 'denied')
    }
    this.onChange?.()
    return this.snapshot()
  }

  private decide(id: unknown, decision: ApprovalDecision): DecideResult {
    const request = this.findPending(parseApprovalId(id))
    if (!request) {
      return { kind: 'unknown' }
    }
    this.finish(request, decision)
    this.onChange?.()
    return { kind: 'ok', approvals: this.snapshot() }
  }

  private findPending(id: string): PendingApproval | undefined {
    return this.readPending().find((item) => item.id === id)
  }

  private finish(request: PendingApproval, decision: ApprovalDecision): void {
    this.db.delete(pendingApprovals).where(eq(pendingApprovals.id, request.id)).run()
    this.db
      .insert(approvalAudit)
      .values({
        id: this.id(),
        requestId: request.id,
        botId: request.botId,
        action: request.action,
        summary: request.summary,
        payload: request.payload,
        decision,
        requestedAt: request.createdAt,
        decidedAt: this.now()
      })
      .run()
    this.settle(request, decision)
  }

  private wait(id: string): Promise<ApprovalVerdict> {
    return new Promise((resolve) => {
      this.waiters.set(id, resolve)
    })
  }

  private settle(request: PendingApproval, decision: ApprovalDecision): void {
    const resolve = this.waiters.get(request.id)
    this.waiters.delete(request.id)
    resolve?.({ kind: decision, request })
  }

  private readPending(): PendingApproval[] {
    return this.db
      .select()
      .from(pendingApprovals)
      .orderBy(asc(pendingApprovals.createdAt), asc(pendingApprovals.id))
      .all()
      .map((row) => ({
        id: parseApprovalId(row.id),
        botId: parseBotId(row.botId),
        action: parseActionClass(row.action),
        summary: row.summary,
        payload: row.payload,
        createdAt: row.createdAt
      }))
  }

  private readAudit(): ApprovalAudit[] {
    return this.db
      .select()
      .from(approvalAudit)
      .orderBy(asc(approvalAudit.decidedAt), asc(approvalAudit.id))
      .all()
      .map((row) => ({
        id: parseAuditId(row.id),
        request: {
          id: parseApprovalId(row.requestId),
          botId: parseBotId(row.botId),
          action: parseActionClass(row.action),
          summary: row.summary,
          payload: row.payload,
          createdAt: row.requestedAt
        },
        decision: parseApprovalDecision(row.decision),
        decidedAt: row.decidedAt
      }))
  }
}
