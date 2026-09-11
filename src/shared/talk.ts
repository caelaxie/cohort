import { parseBotId, type BotId } from './roster'

export type MessageId = string & { readonly __brand: 'MessageId' }

export type Line = {
  readonly id: MessageId
  readonly body: string
  readonly createdAt: number
}

export type ClosedTurn = {
  readonly owner: Line
  readonly bot: Line
}

export type Thread = {
  readonly botId: BotId
  readonly turns: readonly ClosedTurn[]
}

export type SendRequest = {
  readonly botId: BotId
  readonly body: string
}

export type SendResult =
  | { readonly kind: 'ok'; readonly thread: Thread }
  | { readonly kind: 'needs_login' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'too_long' }
  | { readonly kind: 'unknown_bot' }
  | { readonly kind: 'turn_failed'; readonly detail: string }

export type PaintedLine = {
  readonly id: MessageId
  readonly speaker: 'owner' | 'bot'
  readonly body: string
}

export const BODY_MAX = 16_000

const SECRET_FIELDS = ['key', 'apiKey', 'token', 'secret', 'access', 'password'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectSecrets(value: Record<string, unknown>): void {
  for (const field of SECRET_FIELDS) {
    if (field in value) {
      throw new Error('secret field')
    }
  }
}

export function emptyThread(botId: BotId): Thread {
  return { botId, turns: [] }
}

export function parseMessageId(value: unknown): MessageId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid message id')
  }
  return value as MessageId
}

export function parseLine(value: unknown): Line {
  if (!isRecord(value)) {
    throw new Error('invalid line')
  }
  if (typeof value.body !== 'string') {
    throw new Error('invalid line')
  }
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) {
    throw new Error('invalid line')
  }
  return {
    id: parseMessageId(value.id),
    body: value.body,
    createdAt: value.createdAt
  }
}

export function parseClosedTurn(value: unknown): ClosedTurn {
  if (!isRecord(value)) {
    throw new Error('invalid turn')
  }
  return {
    owner: parseLine(value.owner),
    bot: parseLine(value.bot)
  }
}

export function parseThread(value: unknown): Thread {
  if (!isRecord(value)) {
    throw new Error('invalid thread')
  }
  rejectSecrets(value)
  if (!Array.isArray(value.turns)) {
    throw new Error('invalid thread')
  }
  return {
    botId: parseBotId(value.botId),
    turns: value.turns.map(parseClosedTurn)
  }
}

export function parseSendRequest(value: unknown): SendRequest {
  if (!isRecord(value)) {
    throw new Error('invalid send')
  }
  if (typeof value.body !== 'string') {
    throw new Error('invalid send')
  }
  return {
    botId: parseBotId(value.botId),
    body: value.body
  }
}

export function parseSendResult(value: unknown): SendResult {
  if (!isRecord(value)) {
    throw new Error('invalid send result')
  }
  rejectSecrets(value)
  if (value.kind === 'ok') {
    return { kind: 'ok', thread: parseThread(value.thread) }
  }
  if (
    value.kind === 'needs_login' ||
    value.kind === 'busy' ||
    value.kind === 'empty' ||
    value.kind === 'too_long' ||
    value.kind === 'unknown_bot'
  ) {
    return { kind: value.kind }
  }
  if (value.kind === 'turn_failed') {
    if (typeof value.detail !== 'string' || value.detail.length === 0) {
      throw new Error('invalid send result')
    }
    return { kind: 'turn_failed', detail: value.detail }
  }
  throw new Error('unknown kind')
}

export function parseBody(
  value: string
):
  | { readonly kind: 'ok'; readonly body: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'too_long' } {
  const body = value.trim()
  if (body.length === 0) {
    return { kind: 'empty' }
  }
  if (body.length > BODY_MAX) {
    return { kind: 'too_long' }
  }
  return { kind: 'ok', body }
}

export function paint(thread: Thread): readonly PaintedLine[] {
  const lines: PaintedLine[] = []
  for (const turn of thread.turns) {
    lines.push({ id: turn.owner.id, speaker: 'owner', body: turn.owner.body })
    lines.push({ id: turn.bot.id, speaker: 'bot', body: turn.bot.body })
  }
  return lines
}

export function sendCopy(result: Exclude<SendResult, { kind: 'ok' }>): string {
  switch (result.kind) {
    case 'needs_login':
      return 'Connect a model in Settings'
    case 'busy':
      return 'Chief is still answering'
    case 'empty':
      return 'Type a message'
    case 'too_long':
      return 'Message is too long'
    case 'unknown_bot':
      return 'Unknown bot'
    case 'turn_failed':
      return result.detail
  }
}
