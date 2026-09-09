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

export type HomeView =
  | { readonly status: 'opening'; readonly hatch: Hatch }
  | { readonly status: 'ready'; readonly roster: Roster }
  | { readonly status: 'blocked'; readonly hatch: Hatch; readonly message: string }

export type CohortApi = {
  roster: () => Promise<Roster>
  setCurrent: (id: BotId) => Promise<Roster>
  onState: (listener: (roster: Roster) => void) => () => void
}

export function parseBotId(_raw: unknown): BotId {
  throw new Error('not implemented')
}

export function parseRoster(_raw: unknown): Roster {
  throw new Error('not implemented')
}

export function rosterBots(_roster: Roster): readonly [Hatch, ...Teammate[]] {
  throw new Error('not implemented')
}

export function currentBot(_roster: Roster): Bot {
  throw new Error('not implemented')
}

export function openingView(): HomeView {
  throw new Error('not implemented')
}

export function readyView(_roster: Roster): HomeView {
  throw new Error('not implemented')
}

export function blockedView(_message: string): HomeView {
  throw new Error('not implemented')
}

export function headingName(_view: HomeView): string {
  throw new Error('not implemented')
}

export class RosterStore {
  constructor(_home: string) {
    throw new Error('not implemented')
  }

  close(): void {
    throw new Error('not implemented')
  }

  load(): Roster {
    throw new Error('not implemented')
  }

  setCurrent(_id: BotId): Roster {
    throw new Error('not implemented')
  }
}
