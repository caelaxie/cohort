---
name: verify-cohort
description: Drive the Cohort Electron desktop window the way a user does — workspace roster, add-files, files rail, sandbox badge. Use when proving UI behavior, after UI changes, or for /verify-cohort.
---

# Verify Cohort

Cohort is an Electron desktop app (`package.json` name `cohort`, window title `Cohort`). The shipped UI is the leftover workspace loop: left roster, center add-files, right look-only files rail, Boxlite sandbox badge. Hatch / named bots are not on this surface yet. Do not invent them.

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
- renderer text includes `Workspaces` and does not include `The app bridge is missing`

Prints pid, electronPid, cdp URL, home, userData, sqlite workspace count.

## Drive

Use `control-cohort` ARIA commands. Stable handles from this UI:

| Handle | What it is |
| --- | --- |
| `heading` name `Cohort` level 1 | Empty-state main title (no current workspace) |
| `heading` name `Workspaces` level 2 | Left roster heading |
| `button` name `New` | Opens the create form |
| `textbox` name `Name` | Optional display name (`placeholder` Optional) |
| `button` name `Create` | Submits; label becomes `Creating…` while busy |
| `button` name `Cancel` | Closes the form without creating |
| `button` name `<workspace>` | Roster row; current row has `aria-current=page` |
| `heading` name `<workspace>` level 1 | Main title once a workspace is current |
| `button` name `Add files` | Opens the macOS open dialog (only when a workspace is current) |
| `heading` name `Files` level 2 | Right rail, only when a workspace is current |
| `listitem` name `<relative-path>` | Look-only file name in the rail |
| text `No workspaces` | Empty roster |
| text `Create a workspace` | Empty main pane |
| text `Sandbox starting` / `Sandbox ready` / `Sandbox error` | Badge after a workspace is current |
| `alert` | Sidebar/main errors (`role="alert"`) |
| text `Added 1 file.` / `Added N files.` / `No files added.` | Add-files notice |

```bash
$CTRL click --role button --name New
$CTRL fill --role textbox --name Name --value Alpha
$CTRL click --role button --name Create
$CTRL expect --role heading --name Alpha --level 1
$CTRL expect --role button --name Alpha --attr aria-current --value page
$CTRL snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/create-workspace/after.aria.txt
$CTRL screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/create-workspace/after.png
$CTRL roster
```

Names match exactly unless you pass `--no-exact`. Duplicate display names are allowed; two `Notes` buttons are ambiguous — prefer unique names in a run.

`Add files` opens a native `NSOpenPanel`, not a Chromium file chooser. After clicking it:

```bash
$CTRL pick-files -- /path/to/file.txt
```

That is Cmd-Shift-G in the open panel (needs Automation permission for System Events). Do not call `window.cohort.addFiles` or other IPC as a substitute for the user path.

Drop-onto-panel is a second real entry point. Synthetic CDP `DataTransfer` files do not get an OS path (`webUtils.getPathForFile`), so they do not copy. Drive drop from Finder, or skip that entry and report it unreachable.

Read the feature map before driving. A proof that uses one convenient entry is incomplete when the map lists others.

## Evidence

Put proof under `.cursor/skills/verify-cohort/artifacts/<run-id>/<feature>/`. Cleanup must not delete that tree.

Standards:

- Exercise the real window: click `New` / `Create` / roster rows / `Add files`. Do not seed sqlite or invoke IPC to fake the action you are proving.
- Capture the action and the resulting state: ARIA snapshot plus screenshot with `Cohort` and `Workspaces` visible, not only the final frame.
- Prove side effects beside the pixels:
  - create: `$CTRL roster` shows `uuid|name` and `current=<uuid>`; folder `<home>/workspaces/<uuid>/` exists
  - add-files: notice text, Files rail listitem, and the file bytes under that uuid folder
  - switch: `aria-current` moves, h1 changes, Files rail lists the other folder
- Unit tests (`pnpm test`) and `window.cohort.*` are not user-path proof.
- Boxlite is a live sandbox. Treat `Sandbox ready` as proven only if the badge says that; `Sandbox error` plus the alert text is a different observable, not a pass for ready.

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
$CTRL click --role button --name New
$CTRL fill --role textbox --name Name --value Alpha
$CTRL press --key Escape
$CTRL wait --text "No workspaces"
$CTRL expect --role button --name Alpha --attr aria-current --value page
$CTRL expect --text "No workspaces" --gone
$CTRL snapshot --path .cursor/skills/verify-cohort/artifacts/demo/roster.aria.txt
$CTRL screenshot --path .cursor/skills/verify-cohort/artifacts/demo/roster.png
$CTRL text
$CTRL roster
$CTRL files
$CTRL pick-files -- /tmp/notes.txt
$CTRL cleanup
```

Feature recipes: `features/`.
