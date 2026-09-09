export const HATCH_ID = 'hatch' as const
export type HatchId = typeof HATCH_ID

export const HATCH_NAME = 'Hatch' as const

export type Hatch = {
  readonly id: HatchId
  readonly name: typeof HATCH_NAME
}

export const HATCH: Hatch = { id: HATCH_ID, name: HATCH_NAME }

export type TeammateId = string & { readonly __brand: 'TeammateId' }

export type Teammate = {
  readonly id: TeammateId
  readonly name: string
}

export type BotId = HatchId | TeammateId
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
  roster: () => Promise<Roster>
  setCurrent: (id: BotId) => Promise<Roster>
  onState: (listener: (roster: Roster) => void) => () => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
}

export function parseBotId(raw: unknown): BotId {
  if (raw === HATCH_ID) return HATCH_ID
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new Error('invalid bot id')
  }
  return raw.toLowerCase() as TeammateId
}

function parseHatch(raw: unknown): Hatch {
  if (!isRecord(raw) || raw.id !== HATCH_ID || raw.name !== HATCH_NAME) {
    throw new Error('invalid hatch')
  }
  return HATCH
}

function parseTeammate(raw: unknown): Teammate {
  if (!isRecord(raw) || typeof raw.name !== 'string') {
    throw new Error('invalid teammate')
  }
  const id = parseBotId(raw.id)
  if (id === HATCH_ID) {
    throw new Error('Hatch cannot be a teammate')
  }
  return { id, name: raw.name }
}

export function parseRoster(raw: unknown): Roster {
  if (!isRecord(raw)) {
    throw new Error('invalid roster')
  }
  const hatch = parseHatch(raw.hatch)
  if (!Array.isArray(raw.others)) {
    throw new Error('invalid roster')
  }
  const others = raw.others.map(parseTeammate)
  const seen = new Set<string>([hatch.id])
  for (const teammate of others) {
    if (seen.has(teammate.id)) {
      throw new Error('duplicate bot id')
    }
    seen.add(teammate.id)
  }
  const current = parseBotId(raw.current)
  if (!seen.has(current)) {
    throw new Error('dangling current')
  }
  return { hatch, others, current }
}

export function hatchOnlyRoster(): Roster {
  return { hatch: HATCH, others: [], current: HATCH_ID }
}

export function rosterBots(roster: Roster): readonly [Hatch, ...Teammate[]] {
  return [roster.hatch, ...roster.others]
}

export function currentBot(roster: Roster): Bot {
  if (roster.current === roster.hatch.id) return roster.hatch
  const teammate = roster.others.find((item) => item.id === roster.current)
  if (!teammate) {
    throw new Error('dangling current')
  }
  return teammate
}
