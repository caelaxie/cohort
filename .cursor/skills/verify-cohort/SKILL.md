---
name: verify-cohort
description: Drive the Cohort Electron desktop window the way a user does — crew roster with Hatch as lead. Use when proving UI behavior, after UI changes, or for /verify-cohort.
---

# Verify Cohort

Cohort is an Electron desktop app (`package.json` name `cohort`, window title `Cohort`). The shipped home is a crew roster. Hatch is the lead bot. Talk, hatching, add-files, and the files rail are not on this screen.

Drive the **Electron window** over CDP. Opening the Vite URL in Chrome is not Cohort: the preload bridge is missing and the UI shows `The app bridge is missing. Restart Cohort.`

Harness: `.cursor/skills/verify-cohort/scripts/control-cohort`

```bash
CTRL=".cursor/skills/verify-cohort/scripts/control-cohort"
```

## Launch

From the repo root, after `pnpm install` (once per checkout; `postinstall` rebuilds `better-sqlite3` for Electron):

```bash
$CTRL launch
```

That starts `node_modules/.bin/electron-vite dev --remoteDebuggingPort <free> -- --user-data-dir=<run>/electron-profile` with `COHORT_HOME=<run>/home`.

Ready when:

- stdout contains `OK launch`
- `http://127.0.0.1:<cdp>/json/list` has a `page` whose `title` is `Cohort`
- launch log contains `starting electron app...` then `DevTools listening on ws://127.0.0.1:<cdp>/devtools/browser/...`

Default renderer in dev is `http://localhost:5173/` **inside Electron**. If 5173 is taken, Vite picks another port; still drive CDP, not that URL in a browser.

Scratch lives in `.cursor/skills/verify-cohort/runs/<id>/` (`home/`, `electron-profile/`, `launch.log`, `run.json`). Override with `VERIFY_COHORT_RUN` or `--run-dir`. Concurrent runs are allowed only with distinct run dirs (distinct `COHORT_HOME`, user-data-dir, and CDP port).

The app takes a single-instance lock per user-data-dir. Launching without `--user-data-dir` focuses the owner's existing window. `control-cohort launch` always sets an isolated profile. If a previous verification pid is still alive, launch refuses unless you pass `--run-dir` or `cleanup` first.

Teardown: `control-cohort cleanup` (see Cleanup).

## Doctor

```bash
$CTRL doctor
```

Read-only. Run it before the first drive, after any failed drive, and whenever the window looks wrong. Pass means:

- launcher pid from `run.json` is alive
- Electron (not some other process) owns `127.0.0.1:<cdp>`
- `COHORT_HOME` is this run's `home/`, never `~/.cohort`
- user-data-dir is this run's `electron-profile/`
- CDP page title is `Cohort`
- renderer text includes `Crew` and `Hatch` and does not include `The app bridge is missing`

Prints pid, electronPid, cdp URL, home, userData, teammate count.

## Drive

Use `control-cohort` ARIA commands. Stable handles from this UI:

| Handle | What it is |
| --- | --- |
| `heading` name `Crew` level 2 | Left roster heading |
| `button` name `Hatch` | Lead bot. Current row has `aria-current=page` |
| `heading` name `Hatch` level 1 | Main title while Hatch is current, including first paint |
| `alert` | Sidebar errors (`role="alert"`) |

```bash
$CTRL expect --role heading --name Crew --level 2
$CTRL expect --role button --name Hatch --attr aria-current --value page
$CTRL expect --role heading --name Hatch --level 1
$CTRL snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/bot-roster/home.aria.txt
$CTRL screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/bot-roster/home.png
$CTRL roster
```

Names match exactly unless you pass `--no-exact`. Read the feature map before driving. A proof that uses one convenient entry is incomplete when the map lists others.

## Evidence

Put proof under `.cursor/skills/verify-cohort/artifacts/<run-id>/<feature>/`. Cleanup must not delete that tree.

Standards:

- Exercise the real window: Hatch on first paint, Crew heading, current `aria-current=page`. Do not seed sqlite to fake Hatch. Hatch is not a sqlite row.
- Capture the action and the resulting state: ARIA snapshot plus screenshot with Cohort, Crew, and Hatch visible.
- Prove side effects: `$CTRL roster` prints `current=hatch` and `hatch|Hatch`.
- Unit tests (`pnpm test`) are not user-path proof.

## Cleanup

```bash
$CTRL cleanup
```

Sends SIGTERM to the process group `control-cohort launch` started, then to the Electron pid that owns the CDP port if it is still up. It does not `pkill Electron` or kill by process name.

Removes the run dir (`home/`, `electron-profile/`, `launch.log`, `run.json`). Does **not** remove `.cursor/skills/verify-cohort/artifacts/`. After cleanup, confirm the proof files still exist at the paths you wrote.

If a drive fails, run `cleanup` before the next `launch` so ports and profiles are not stranded.

## Helpers

`scripts/control-cohort` is executable. First CDP command installs `playwright-core` into `scripts/` if needed (not an app dependency).

```bash
$CTRL help
$CTRL launch
$CTRL doctor
$CTRL expect --role button --name Hatch --attr aria-current --value page
$CTRL snapshot --path .cursor/skills/verify-cohort/artifacts/demo/roster.aria.txt
$CTRL screenshot --path .cursor/skills/verify-cohort/artifacts/demo/roster.png
$CTRL text
$CTRL roster
$CTRL cleanup
```

Feature recipes: `features/`.
