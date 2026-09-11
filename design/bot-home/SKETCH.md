# Bot home

Chief is a compile-time identity, not a sqlite row. A loaded roster always has `chief`. Selecting a bot sets `current`. Leftover workspace/files/box leave the live path and leave the tree.

## Usage

```ts
const store = new RosterStore(home)
const first = store.load()
// first.chief === CHIEF
// first.others === []
// first.current === 'chief'

store.load() // same Roster. No Chief row to insert.

store.select(CHIEF_ID) // no sqlite write when already current
```

Renderer first paint is Chief chrome. IPC overwrites it.

```tsx
const [view, setView] = useState<HomeView>(() =>
  window.cohort
    ? viewWith(chiefOnlyRoster())
    : viewWith(chiefOnlyRoster(), 'The app bridge is missing. Restart Cohort.')
)

useEffect(() => {
  if (!window.cohort) return
  void window.cohort
    .home()
    .then((raw) => setView(viewWith(parseRoster(raw))))
    .catch((reason: unknown) => {
      setView((prev) =>
        viewWith(prev.roster, reason instanceof Error ? reason.message : 'Could not load bots')
      )
    })
}, [])
```

IPC: `cohort:home`, `cohort:select`. No push. No `list` / `create` / `addFiles`. No `BoxManager`.

## Shape

```ts
export const CHIEF_ID = 'chief' as const
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

export type CohortApi = {
  home: () => Promise<unknown>
  select: (id: string) => Promise<unknown>
}
```

`parseRoster(unknown)` is the only constructor from IPC. It rejects missing Chief, Chief in `others`, duplicate ids, and dangling current.

`chiefOnlyRoster()` returns `{ chief: CHIEF, others: [], current: CHIEF_ID }`.
`rosterBots(roster)` is `[chief, ...others]`.
`currentBot(roster)` is paint-time. Talk can add a thread later.

`RosterStore.load` reads `teammates` (empty this slice) and `meta.current_id`. Missing or dangling current, including leftover `current_uuid`, repairs to `'chief'`. Chief is never a teammates row. `select` throws on unknown ids and skips the meta write when already current.

## Module map

- `src/shared/roster.ts` — types, CHIEF, parse, helpers
- `src/main/schema.ts` + `db.ts` — `teammates` + `meta`. No `workspaces` on the live path.
- `src/main/roster.ts` — `RosterStore`
- `src/main/ipc.ts` — `home` / `select`
- `src/preload/index.ts` — allowlist, payloads stay unknown
- `src/renderer/src/App.tsx` — `chiefOnlyRoster()` first paint
- `src/renderer/src/components/bot-sidebar.tsx` — heading Crew, Chief first, `aria-current="page"`
- `src/renderer/src/components/bot-main.tsx` — `h1` is current bot name, empty pane, no composer, no sandbox, no add-files

Delete from the tree: `workspaces.ts`, `files.ts`, `box.ts`, `live-box.ts`, `app-state.ts`, `shared/workspace.ts`, workspace renderer components, their tests, `notice.ts`. Update `paths.ts` so live code does not mention workspace dirs. Update verify-cohort so `doctor` and `state` call `home()`, not `list()`.

## Tests

`src/main/roster.test.ts` asserts empty roster, reopen, dangling current repair, and select-Chief is a no-op write. `parseRoster` throws without Chief and on Chief in `others`.
