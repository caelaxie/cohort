# Bot roster

Home is the named-bot roster. Hatch is the lead bot on launch. The Crew sidebar lists Hatch first. The main pane shows Hatch's name and an empty thread.

## Sub-features

- `launch-hatch` shows Hatch as current on a fresh home.
- `crew-heading` labels the sidebar `Crew`.
- `empty-thread` shows Hatch's name in the `h1` and no composer, sandbox badge, or files rail.
- `persist-reopen` keeps Hatch current after quit and relaunch against the same scratch home.
- `click-hatch-stays` leaves Hatch current when the Hatch row is clicked.

## How to get to it (user POV)

- Launch Cohort. Hatch is already on the roster.
- Click `Hatch` in the Crew sidebar.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- The scratch home has not been given a workspace or teammate row.

- **Launch Hatch.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h2 "Crew"`, a Hatch button with `aria-current="page"`, and `h1 "Hatch"`. It does not show `New`, `Add files`, or a `Files` rail.
- **Empty thread.** Run `... eval --port $PORT --js "document.querySelector('h1')?.textContent"`. It prints `"Hatch"`. Run `... eval --port $PORT --js "[...document.querySelectorAll('textarea, input, header span')].map(el => el.tagName)"`. It prints `[]`.
- **State.** Run `... state --port $PORT --path "$RUN_ROOT/evidence/bot-roster/state.json"`. `hatch.id` is `hatch`, `hatch.name` is `Hatch`, `current` is `hatch`, and `others` is `[]`. Then outside the UI: `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT key, value FROM meta WHERE key='current_id'; SELECT id, name FROM teammates;"` shows `current_id|hatch` and no teammate rows.
- **Click Hatch.** Run `... click --port $PORT --text "Hatch"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Hatch'"`. The `h1` still reads `Hatch`, and `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"` prints `"Hatch"`. `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT value FROM meta WHERE key='current_id';"` is still `hatch`.
- **Reopen.** Tear down the instance per `../SKILL.md` cleanup but keep `$RUN_ROOT/home`. Relaunch with the same `COHORT_HOME=$RUN_ROOT/home`, then `doctor`. `... state --port $PORT` still has `current` of `hatch` and `hatch.name` of `Hatch`. The snapshot still shows Crew and `h1 "Hatch"`.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/bot-roster/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/bot-roster/after.png"`. Both show Hatch current under Crew.

## Gotchas

- First paint is Hatch before `home()` returns. Wait for `doctor` so the preload bridge has answered, not only for the window to appear.
- Clicking Hatch is a no-op write. Assert the same current id, not a new sqlite row.
- There is no `New` button and no way to add a teammate in this slice. A snapshot that shows Workspaces, Add files, or a sandbox badge is leftover UI, not a missing fixture.
