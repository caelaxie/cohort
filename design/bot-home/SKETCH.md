# Bot home

Hatch is a compile-time identity, not a sqlite row. A loaded roster always has `hatch`. Selecting a bot opens an `EmptyThread`. Leftover workspace/files/box leave the live path and leave the tree.

## Usage

```ts
const store = new RosterStore(home)
const first = store.load()
// first.roster.hatch === HATCH
// first.roster.others === []
// first.roster.current === 'hatch'
// first.thread.messages === []

store.load() // same Home. No Hatch row to insert.

store.select(HATCH_ID) // no sqlite write when already current
```

Renderer first paint is Hatch chrome. IPC overwrites it.

```tsx
const [view, setView] = useState<HomeView>(() =>
  window.cohort
    ? viewWith(hatchOnlyRoster())
    : viewWith(hatchOnlyRoster(), 'The app bridge is missing. Restart Cohort.')
)

useEffect(() => {
  if (!window.cohort) return
  void window.cohort
    .home()
    .then((raw) => setView(viewWith(parseHome(raw))))
    .catch((reason: unknown) => {
      setView((prev) =>
        viewWith(prev.roster, reason instanceof Error ? reason.message : 'Could not load bots')
      )
    })
  return window.cohort.onState((raw) => setView(viewWith(parseHome(raw))))
}, [])
```

IPC: `cohort:home`, `cohort:select`, push `cohort:state`. No `list` / `create` / `addFiles`. No `BoxManager`.

## Shape

```ts
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

export type EmptyThread = {
  readonly bot: Bot
  readonly messages: readonly []
}

export type Home = {
  readonly roster: Roster
  readonly thread: EmptyThread
}

export type HomeView = {
  readonly roster: Roster
  readonly error: string | null
}

export type CohortApi = {
  home: () => Promise<unknown>
  select: (id: string) => Promise<unknown>
  onState: (listener: (state: unknown) => void) => () => void
}
```

`parseHome(unknown)` is the only constructor from IPC. It rejects missing Hatch, Hatch in `others`, duplicate ids, dangling current, leftover `workspaces` / `files` / `boxStatus` fields, and a non-empty `messages` array.

`hatchOnlyRoster()` returns `{ hatch: HATCH, others: [], current: HATCH_ID }`.
`homeFromRoster(roster)` sets `thread.bot` from `currentBot(roster)` and `messages: []`.
`rosterBots(roster)` is `[hatch, ...others]`.

`RosterStore.load` reads `teammates` (empty this slice) and `meta.current_id`. Missing or dangling current, including leftover `current_uuid`, repairs to `'hatch'`. Hatch is never a teammates row. `select` throws on unknown ids and skips the meta write when already current.

## Module map

- `src/shared/roster.ts` — types, HATCH, parse, helpers
- `src/main/schema.ts` + `db.ts` — `teammates` + `meta`. No `workspaces` on the live path.
- `src/main/roster.ts` — `RosterStore`
- `src/main/ipc.ts` — `home` / `select` / `state`
- `src/preload/index.ts` — allowlist, payloads stay unknown
- `src/renderer/src/App.tsx` — `hatchOnlyRoster()` first paint
- `src/renderer/src/components/bot-sidebar.tsx` — heading Crew, Hatch first, `aria-current="page"`
- `src/renderer/src/components/bot-main.tsx` — `h1` is current bot name, empty thread, no composer, no sandbox, no add-files

Delete from the tree: `workspaces.ts`, `files.ts`, `box.ts`, `live-box.ts`, `app-state.ts`, `shared/workspace.ts`, workspace renderer components, their tests, `notice.ts`. Update `paths.ts` so live code does not mention workspace dirs. Update verify-cohort so `doctor` and `state` call `home()`, not `list()`.

## Tests

`src/main/roster.test.ts` asserts empty home, reopen, dangling current repair, and select-Hatch is a no-op write. `parseHome` throws without Hatch and on leftover workspace fields.
