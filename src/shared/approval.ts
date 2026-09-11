import { isRecord, rejectSecrets } from './parse'
import { parseBotId, type BotId } from './roster'

export const ACTION_CLASSES = ['send', 'post', 'buy', 'delete'] as const
export type ActionClass = (typeof ACTION_CLASSES)[number]

export const SUMMARY_MAX = 280
export const PAYLOAD_MAX = 16_000

export type ApprovalId = string & { readonly __brand: 'ApprovalId' }
export type AuditId = string & { readonly __brand: 'AuditId' }
export type ApprovalDecision = 'approved' | 'denied'

export type ApprovalAsk = {
  readonly botId: BotId
  readonly action: ActionClass
  readonly summary: string
  readonly payload: string
}

export type PendingApproval = ApprovalAsk & {
  readonly id: ApprovalId
  readonly createdAt: number
}

export type ApprovalVerdict =
  | { readonly kind: 'approved'; readonly request: PendingApproval }
  | { readonly kind: 'denied'; readonly request: PendingApproval }

export type ApprovalAudit = {
  readonly id: AuditId
  readonly request: PendingApproval
  readonly decision: ApprovalDecision
  readonly decidedAt: number
}

export type Approvals = {
  readonly pending: readonly PendingApproval[]
  readonly audit: readonly ApprovalAudit[]
}

export type DecideResult =
  { readonly kind: 'ok'; readonly approvals: Approvals } | { readonly kind: 'unknown' }

export function parseApprovalId(value: unknown): ApprovalId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid approval id')
  }
  return value as ApprovalId
}

export function parseAuditId(value: unknown): AuditId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid audit id')
  }
  return value as AuditId
}

export function parseActionClass(value: unknown): ActionClass {
  if (value === 'send' || value === 'post' || value === 'buy' || value === 'delete') {
    return value
  }
  throw new Error('invalid action')
}

export function parseApprovalDecision(value: unknown): ApprovalDecision {
  if (value === 'approved' || value === 'denied') {
    return value
  }
  throw new Error('invalid decision')
}

export function parseApprovalAsk(value: unknown): ApprovalAsk {
  if (!isRecord(value)) {
    throw new Error('invalid approval')
  }
  rejectSecrets(value)
  if (typeof value.summary !== 'string') {
    throw new Error('invalid approval')
  }
  if (typeof value.payload !== 'string') {
    throw new Error('invalid approval')
  }
  const summary = value.summary.trim()
  if (summary.length === 0) {
    throw new Error('empty summary')
  }
  if (summary.length > SUMMARY_MAX) {
    throw new Error('summary too long')
  }
  if (value.payload.length > PAYLOAD_MAX) {
    throw new Error('payload too long')
  }
  return {
    botId: parseBotId(value.botId),
    action: parseActionClass(value.action),
    summary,
    payload: value.payload
  }
}

export function parsePendingApproval(value: unknown): PendingApproval {
  if (!isRecord(value)) {
    throw new Error('invalid pending')
  }
  rejectSecrets(value)
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) {
    throw new Error('invalid pending')
  }
  const ask = parseApprovalAsk(value)
  return {
    id: parseApprovalId(value.id),
    ...ask,
    createdAt: value.createdAt
  }
}

export function parseApprovalVerdict(value: unknown): ApprovalVerdict {
  if (!isRecord(value)) {
    throw new Error('invalid verdict')
  }
  rejectSecrets(value)
  if (value.kind !== 'approved' && value.kind !== 'denied') {
    throw new Error('unknown kind')
  }
  return { kind: value.kind, request: parsePendingApproval(value.request) }
}

export function parseApprovalAudit(value: unknown): ApprovalAudit {
  if (!isRecord(value)) {
    throw new Error('invalid audit')
  }
  rejectSecrets(value)
  if (typeof value.decidedAt !== 'number' || !Number.isFinite(value.decidedAt)) {
    throw new Error('invalid audit')
  }
  return {
    id: parseAuditId(value.id),
    request: parsePendingApproval(value.request),
    decision: parseApprovalDecision(value.decision),
    decidedAt: value.decidedAt
  }
}

export function parseApprovals(value: unknown): Approvals {
  if (!isRecord(value)) {
    throw new Error('invalid approvals')
  }
  rejectSecrets(value)
  if (!Array.isArray(value.pending) || !Array.isArray(value.audit)) {
    throw new Error('invalid approvals')
  }
  return {
    pending: value.pending.map(parsePendingApproval),
    audit: value.audit.map(parseApprovalAudit)
  }
}

export function parseDecideResult(value: unknown): DecideResult {
  if (!isRecord(value)) {
    throw new Error('invalid decide')
  }
  rejectSecrets(value)
  if (value.kind === 'ok') {
    return { kind: 'ok', approvals: parseApprovals(value.approvals) }
  }
  if (value.kind === 'unknown') {
    return { kind: 'unknown' }
  }
  throw new Error('unknown kind')
}
