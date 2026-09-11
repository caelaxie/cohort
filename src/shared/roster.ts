export const CHIEF_ID = 'chief' as const
export const LEGACY_LEAD_ID = 'hatch' as const
export type ChiefId = typeof CHIEF_ID
export type TeammateId = string & { readonly __brand: 'TeammateId' }
export type BotId = ChiefId | TeammateId

export type Chief = { readonly id: ChiefId; readonly name: 'Chief' }
export const CHIEF: Chief = { id: CHIEF_ID, name: 'Chief' }

export type Teammate = { readonly id: TeammateId; readonly name: string }
export type Bot = Chief | Teammate

export type Roster = {
  readonly chief: Chief
  readonly others: readonly Teammate[]
  readonly current: BotId
}

export type HomeView = {
  readonly roster: Roster
  readonly error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBotId(value: unknown): BotId {
  if (value === CHIEF_ID) return CHIEF_ID
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid bot id')
  }
  return value as TeammateId
}

export function chiefOnlyRoster(): Roster {
  return { chief: CHIEF, others: [], current: CHIEF_ID }
}

export function rosterBots(roster: Roster): readonly [Chief, ...Teammate[]] {
  return [roster.chief, ...roster.others]
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

function parseChief(value: unknown): Chief {
  if (!isRecord(value) || value.id !== CHIEF_ID || value.name !== 'Chief') {
    throw new Error('missing chief')
  }
  return CHIEF
}

export function parseTeammate(value: unknown): Teammate {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error('invalid teammate')
  }
  const id = parseBotId(value.id)
  if (id === CHIEF_ID) {
    throw new Error('chief in others')
  }
  return { id, name: value.name }
}

export function parseRoster(value: unknown): Roster {
  if (!isRecord(value)) {
    throw new Error('invalid roster')
  }
  const chief = parseChief(value.chief)
  if (!Array.isArray(value.others)) {
    throw new Error('invalid roster')
  }
  const others = value.others.map(parseTeammate)
  const ids = new Set<string>([chief.id])
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
  return { chief, others, current }
}
