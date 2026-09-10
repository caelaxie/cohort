# Bot home

## Problem

Cohort's home is a workspace roster. First paint is `{ workspaces: [], boxStatus: 'none' }` and the copy "No workspaces". `create` steals current and remounts Boxlite. `setCurrent` remounts even when already current. A files rail appears whenever something is current. v1 home is a named-bot roster that always includes Hatch as the lead bot. The owner opens the app, sees Hatch, sees other named bots if they exist, and can select current. Talk, hatch-another, rooms, Prime, add-files, the files rail, and the sandbox badge are out of this slice.

## Usage (caller's view)

The owner opens Cohort. The chrome is a crew roster. Hatch is already on screen as the lead bot. There is no New, no "Create a workspace", no add-files, no files rail, no sandbox badge. Clicking a bot highlights it and sets the main heading to that name. Clicking the already-current bot does nothing. There is no chat yet.

```ts
const [view, setView] = useState<HomeView>(openingView())

useEffect(() => {
  if (!window.cohort) {
    setView(blockedView('The app bridge is missing. Restart Cohort.'))
    return
  }
  void window.cohort
    .roster()
    .then((roster) => setView(readyView(roster)))
    .catch((reason: unknown) => {
      setView(blockedView(reason instanceof Error ? reason.message : 'Could not load bots'))
    })
  return window.cohort.onState((roster) => setView(readyView(roster)))
}, [])

const onSelect = (id: BotId): void => {
  if (view.status === 'ready' && view.roster.current === id) return
  void window.cohort.setCurrent(id).then((roster) => setView(readyView(roster)))
}
```

Sidebar lists `rosterBots(view)` which is always `[Hatch, ...others]`. Main `h1` is `headingName(view)`.

Preload parses `unknown` with `parseRoster`. Public API is `roster`, `setCurrent`, `onState`. No `list`, `create`, `addFiles`.

Main:

```ts
const store = new RosterStore(home)
ipcMain.handle('cohort:roster', () => store.load())
ipcMain.handle('cohort:setCurrent', (_event, raw: unknown) => store.setCurrent(parseBotId(raw)))
```

No `BoxManager` construction.

## Shape

Hatch is the constant `HATCH` (`id: 'hatch'`, `name: 'Hatch'`). It is not a sqlite row. Persistence cannot represent a Hatch-less world.

`Roster` is `{ hatch: Hatch, others: readonly Teammate[], current: BotId }`. `others` may be empty. The roster cannot. `current` is Hatch's id or a teammate id. `parseRoster` is the only constructor and throws on leftover workspace/files/box fields, missing Hatch, Hatch in `others`, duplicate ids, or a dangling current.

`RosterStore.load` reads teammates and `meta.current_id`. Missing or dangling current is repaired to `'hatch'`. `setCurrent` no-ops with no meta write when already current. Unknown ids throw.

Module map:

- `src/shared/roster.ts`
- `src/main/schema.ts` + `db.ts` — `teammates` + `meta`. Drop leftover `workspaces` from the live path.
- `src/main/roster.ts` — `RosterStore`
- `src/main/ipc.ts` — `cohort:roster` / `cohort:setCurrent` / `cohort:state`
- `src/preload/index.ts`
- `src/renderer` — `openingView()`, `bot-sidebar`, `bot-main`. Delete workspace sidebar, main, and files rail from the live tree.

## Synthesis decision

See `SYNTHESIS.md`. Base is arena candidate 2. Grafted from candidate 3: `current` as `BotId`, leftover-field rejection in parse, `rosterBots` / `currentBot`, heading "Crew".

## Tradeoffs accepted

- We accept a one-frame Hatch-as-current highlight when the stored current is a teammate, in exchange for a first paint that is already a bot home.
- We accept Hatch living only in code, not in sqlite, in exchange for making a Hatch-less loaded roster unrepresentable even under `DELETE FROM teammates`.
- We accept dropping leftover workspace rows instead of importing them as teammates.
- We accept no create IPC in this slice.

## Alternatives considered

- Homogeneous `[Bot, ...Bot[]]` with a runtime Hatch check. Callers can still build a list without Hatch.
- Seed Hatch as a sqlite row. A row can be omitted.
- Keep `AppStateDto` and rename workspaces to bots. Dual leftover API.
- Loading shell with no Hatch on first paint. Still a Hatch-less frame.
- Keep `BoxManager` and skip remount. Select would still mean sandbox.

## Open questions and risks

- Later Hatch-specific persisted fields should be a side table, not a Hatch row in `teammates`.
- A teammate whose display name is the string "Hatch" stays a teammate. Id is the discriminant.

## Next implementation step

Implement `RosterStore.load` so an empty `COHORT_HOME` returns Hatch as the only member and as current, then wire IPC and `openingView()`.
