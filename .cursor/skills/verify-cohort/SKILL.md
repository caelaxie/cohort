---
name: verify-cohort
description: Drive the real Cohort desktop app (Electron + React) to prove user-facing behavior. Launch an isolated instance, exercise features over CDP, capture evidence. Use when a change touches the main process, preload, renderer UI, or the named-bot roster.
---

# Verify Cohort

Cohort is an Electron desktop app (macOS): one window, React renderer, named-bot roster in the left sidebar under Crew, Chief as the lead bot, and a Chief thread with a Message composer in the main pane. State lives in `$COHORT_HOME` (SQLite). Chief is a compile-time identity, not a sqlite row.

This skill launches a throwaway instance, drives it over the Chrome DevTools Protocol, and captures proof. It never touches the user's real `~/.cohort` data or any other Electron app on this Mac.

## Prerequisites

- Repo deps installed: `pnpm install` (postinstall rebuilds better-sqlite3 for Electron).
- Node 22+ on PATH for the helper (uses global `fetch`/`WebSocket`).
- Helper: `scripts/cohort-drive.mjs` relative to this skill directory. Run it as `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs <command>` from the repo root.

## Launch

From the repo root:

```sh
RUN_ID="$(date +%Y%m%d-%H%M%S)"
PORT=$((9000 + RANDOM % 900))
RUN_ROOT="$TMPDIR/cohort-verify/$RUN_ID"
mkdir -p "$RUN_ROOT/home" "$RUN_ROOT/user-data" "$RUN_ROOT/evidence"

COHORT_HOME="$RUN_ROOT/home" \
ELECTRON_CLI_ARGS="[\"--user-data-dir=$RUN_ROOT/user-data\"]" \
REMOTE_DEBUGGING_PORT=$PORT \
pnpm dev > "$RUN_ROOT/app.log" 2>&1 &
echo $! > "$RUN_ROOT/launch.pid"
echo "$RUN_ROOT $PORT"
```

- Run the launch as a background job that outlives the command. In Cursor, use the Shell tool's background mode, not a bare `&`, which gets reaped when the tool call returns.
- `COHORT_HOME` isolates app data (roster DB) and Electron's profile (`$COHORT_HOME/electron`), which is the single-instance lock. `--user-data-dir` is still passed so Chromium isolation matches if the flag is honored. Without a scratch `COHORT_HOME` the app can refuse to start or focus another instance.
- Ready signal: `curl -s http://127.0.0.1:$PORT/json/list` returns a `page` target titled `Cohort` (usually 3–8 s; the dev server must build main, preload, and renderer first).
- A real window opens on screen. That is expected; cleanup closes it.
- `pnpm dev` watches sources and restarts the main process on edits. Do not edit `src/` while an instance is up.
- Record `RUN_ROOT` and `PORT`; every later step needs them.

## Doctor

Run first whenever anything looks off, and once after every launch:

```sh
node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs doctor --port $PORT
```

`doctor` exits 0 only when the CDP endpoint answers, a `page` target exists, the `window.cohort` preload bridge is present, and `cohort.home()` returns. It prints page title/URL, Chief id and name, and the current bot id as JSON.

Also check, before driving:

- `kill -0 "$(cat "$RUN_ROOT/launch.pid")"` confirms the wrapper we started is alive.
- `lsof -nP -iTCP:$PORT -sTCP:LISTEN` shows a listener (the port belongs to this run; `$PORT` was random).
- `$RUN_ROOT` is under `$TMPDIR/cohort-verify/`. If it ever resolves to `~/.cohort` or another real path, stop. Do not drive that instance.

If `doctor` fails, read `$RUN_ROOT/app.log` (build errors, Electron crashes), fix the cause, tear down, and relaunch.

## Drive

All commands: `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs <cmd> --port $PORT ...`. Exit code 0 on success, 1 with a stderr message on failure.

| Command                             | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `doctor`                            | instance health (see above)                                        |
| `state [--path f.json]`             | print `window.cohort.home()` (read-only state dump)                |
| `eval --js EXPR`                    | evaluate EXPR in the page, print JSON result                       |
| `click --text TXT`                  | click a visible button/link whose trimmed text is exactly TXT      |
| `click --selector CSS`              | click by CSS selector                                              |
| `fill --label TXT --value V`        | set the input inside `<label>` containing TXT (React-safe)         |
| `fill --selector CSS --value V`     | set by CSS selector                                                |
| `key --key Escape [--selector CSS]` | dispatch a keydown                                                 |
| `wait --js EXPR [--timeout MS]`     | poll EXPR (default 15 s) until truthy                              |
| `snapshot [--path f.txt]`           | text tree of visible headings, buttons, inputs, alerts, list items |
| `screenshot --path f.png`           | PNG of the window                                                  |

Stable handles in this repo (prefer these over CSS position):

- Sidebar heading: `Crew`.
- Current bot: sidebar button with `aria-current="page"`; main header is the `h1`.
- Chief row: button whose trimmed text is `Chief`.
- Settings footer: button whose trimmed text is `Settings`. The Settings pane `h1` is `Settings`.
- Errors render in `p[role="alert"]`.

Feature-by-feature recipes live in `features/`. Read `features/README.md` before driving.

## Evidence

Proof artifacts go in `$RUN_ROOT/evidence/` and survive cleanup. For every feature proof capture:

1. The action and the resulting state, not only the final screen: `snapshot` before and after, plus a `screenshot` after.
2. `state --path "$RUN_ROOT/evidence/<step>.json"` after mutations.
3. Side effects outside the UI:
   - Roster DB: `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT key, value FROM meta; SELECT id, name FROM teammates;"`.
   - Talk DB: `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT owner_body, bot_body FROM turns ORDER BY created_at, owner_id;"`.
   - Kernel auth when `COHORT_HOME` is set: `$RUN_ROOT/home/prime/agent/auth.json`. Never the owner's `~/.prime/agent/auth.json`.
4. Name artifacts after the feature and step, e.g. `bot-roster/after.png`.

Proof standards:

- Drive the real user path: DOM clicks on the actual window. Do not call `window.cohort.select` to set up a state you then claim the UI produced. (`state`/`eval` are for observation.)
- This app has no dry-run mode; every mutation is real inside the scratch `COHORT_HOME`.

## Cleanup

Teardown removes the instance and scratch app state. It never removes evidence.

```sh
kill "$(cat "$RUN_ROOT/launch.pid")" 2>/dev/null
sleep 1
pkill -f "$RUN_ROOT" 2>/dev/null   # electron children carry --user-data-dir=$RUN_ROOT/...
for i in 1 2 3 4 5; do
  curl -s --max-time 1 "http://127.0.0.1:$PORT/json/list" >/dev/null || break
  sleep 1
done
rm -rf "$RUN_ROOT/home" "$RUN_ROOT/user-data"
echo "evidence kept at $RUN_ROOT/evidence"
```

- Never `pkill` by process name (`electron`, `cohort`): the user runs other Electron apps on this Mac. Kill the recorded PID and processes whose command line contains this run's unique `$RUN_ROOT` path.
- After cleanup, confirm the port refuses connections and `ls "$RUN_ROOT/evidence"` still lists the artifacts. If evidence is missing, the run is invalid. Say so.

## Helpers

`scripts/cohort-drive.mjs` is the only helper; it is self-contained (zero npm deps) and executable via `node`. Its command table above is the interface. `--help`-style discovery is intentionally absent. Read the table.
