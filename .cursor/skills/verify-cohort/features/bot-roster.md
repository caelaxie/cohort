# Bot roster

Home is the named-bot roster. Chief is the lead bot on launch. The Crew sidebar lists Chief first. The main pane shows Chief's name, an empty thread, and a Message composer.

## Sub-features

- `launch-chief` shows Chief as current on a fresh home.
- `crew-heading` labels the sidebar `Crew`.
- `empty-thread` shows Chief's name in the `h1`, a Message composer, and no sandbox badge or files rail.
- `persist-reopen` keeps Chief current after quit and relaunch against the same scratch home.
- `click-chief-stays` leaves Chief current when the Chief row is clicked.

## How to get to it (user POV)

- Launch Cohort. Chief is already on the roster.
- Click `Chief` in the Crew sidebar.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- The scratch home has not been given a workspace or teammate row.

- **Launch Chief.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h2 "Crew"`, a Room button, a Chief button with `aria-current="page"`, and `h1 "Chief"`. It does not show `New`, `Add files`, or a `Files` rail.
- **Empty thread.** Run `... eval --port $PORT --js "document.querySelector('h1')?.textContent"`. It prints `"Chief"`. Run `... eval --port $PORT --js "[...document.querySelectorAll('textarea')].length"`. It prints `1`. The snapshot includes `Message` and `Send`. It does not show `New`, `Add files`, or a `Files` rail.
- **State.** Run `... state --port $PORT --path "$RUN_ROOT/evidence/bot-roster/state.json"`. `chief.id` is `chief`, `chief.name` is `Chief`, `current` is `chief`, and `others` is `[]`. Then outside the UI: `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT key, value FROM meta WHERE key='current_id'; SELECT id, name FROM teammates;"` shows `current_id|chief` and no teammate rows.
- **Click Chief.** Run `... click --port $PORT --text "Chief"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Chief'"`. The `h1` still reads `Chief`, and `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"` prints `"Chief"`. `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT value FROM meta WHERE key='current_id';"` is still `chief`.
- **Reopen.** Tear down the instance per `../SKILL.md` cleanup but keep `$RUN_ROOT/home`. Relaunch with the same `COHORT_HOME=$RUN_ROOT/home`, then `doctor`. `... state --port $PORT` still has `current` of `chief` and `chief.name` of `Chief`. The snapshot still shows Crew and `h1 "Chief"`.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/bot-roster/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/bot-roster/after.png"`. Both show Chief current under Crew.

## Gotchas

- First paint is Chief before `home()` returns. Wait for `doctor` so the preload bridge has answered, not only for the window to appear.
- Clicking Chief is a no-op write. Assert the same current id, not a new sqlite row.
- There is no sidebar `New` button. Hatch lives on the Chief pane (`Name` + `Hatch`). A snapshot that shows Workspaces, Add files, or a sandbox badge is leftover UI, not a missing fixture.
