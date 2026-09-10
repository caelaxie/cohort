export const HATCH_ID = 'hatch' as const
export type HatchId = typeof HATCH_ID
export type TeammateId = string & { readonly __brand: 'TeammateId' }
export type BotId = HatchId | TeammateId

export type Hatch = { readonly id: HatchId; readonly name: 'Hatch' }
export const HATCH: Hatch = { id: HATCH_ID, name: 'Hatch' }

export type Teammate = { readonly id: TeammateId; readonly name: string }
export type Bot = Hatch | Teammate

export type Roster = {
  readonly hatch: Hatch
  readonly others: readonly Teammate[]
  readonly current: BotId
}

export type HomeView = {
  readonly roster: Roster
  readonly error: string | null
}

export type CohortApi = {
  home: () => Promise<unknown>
  select: (id: string) => Promise<unknown>
  kernel: () => Promise<unknown>
  connect: (input?: unknown) => Promise<unknown>
  onOpenSettings: (callback: () => void) => () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBotId(value: unknown): BotId {
  if (value === HATCH_ID) return HATCH_ID
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid bot id')
  }
  return value as TeammateId
}

export function hatchOnlyRoster(): Roster {
  return { hatch: HATCH, others: [], current: HATCH_ID }
}

export function rosterBots(roster: Roster): readonly [Hatch, ...Teammate[]] {
  return [roster.hatch, ...roster.others]
}

export function currentBot(roster: Roster): Bot {
  const bot = rosterBots(roster).find((item) => item.id === roster.current)
  if (!bot) {
    throw new Error('dangling current')
  }
  return bot
}

export function viewWith(roster: Roster, error: string | null = null): HomeView {
  return { roster, error }
}

function parseHatch(value: unknown): Hatch {
  if (!isRecord(value) || value.id !== HATCH_ID || value.name !== 'Hatch') {
    throw new Error('missing hatch')
  }
  return HATCH
}

export function parseTeammate(value: unknown): Teammate {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error('invalid teammate')
  }
  const id = parseBotId(value.id)
  if (id === HATCH_ID) {
    throw new Error('hatch in others')
  }
  return { id, name: value.name }
}

export function parseRoster(value: unknown): Roster {
  if (!isRecord(value)) {
    throw new Error('invalid roster')
  }
  const hatch = parseHatch(value.hatch)
  if (!Array.isArray(value.others)) {
    throw new Error('invalid roster')
  }
  const others = value.others.map(parseTeammate)
  const ids = new Set<string>([hatch.id])
  for (const teammate of others) {
    if (ids.has(teammate.id)) {
      throw new Error('duplicate bot id')
    }
    ids.add(teammate.id)
  }
  const current = parseBotId(value.current)
  if (!ids.has(current)) {
    throw new Error('dangling current')
  }
  return { hatch, others, current }
}
