# Cohort verification map

This directory is the maintained source for verifying the user-facing behavior of Cohort (Electron desktop app). Read this index before driving the app, then use the matching feature file as the recipe. Launch, doctor, drive, evidence, and cleanup mechanics are in `../SKILL.md`; the helper is `../scripts/cohort-drive.mjs` (run with `node`, from the repo root).

## Baseline preconditions

- Instance launched per `../SKILL.md` with scratch `COHORT_HOME=$RUN_ROOT/home`, `--user-data-dir=$RUN_ROOT/user-data`, and `REMOTE_DEBUGGING_PORT=$PORT`.
- `doctor` passed and the recorded launch PID is alive.
- `$RUN_ROOT` is under `$TMPDIR/cohort-verify/` — never the user's real `~/.cohort`.
- No workspace exists unless the recipe created it in this run.
- Never drive an instance this verification run did not start.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer exact button text, the `Name` label, `aria-current="page"`, and the `h1` over CSS position.
- Treat every command as literal. Keep quoted names unchanged.
- Observe state with `state`, `snapshot`, and `eval`; mutate only through DOM `click`/`fill`/`key`, except the add-files drop path documented in `add-files.md`.
- Workspace names in recipes (`Verify Alpha`, `Verify Beta`) are fixtures; create them in the run and let cleanup remove the scratch home.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof: `snapshot` before/after plus a `screenshot` after, with the workspace name visible in the `h1`.
- Mutation proof: a read-only second view — `state` JSON, the workspace folder on disk, and the `state.sqlite` rows.
- Sandbox proof: the badge text and, on error, the `p[role="alert"]` box error.
- Record the feature ID and `$RUN_ROOT` with every artifact batch.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with cohort-drive` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Create a workspace](./create-workspace.md) covers drafting, naming, blank-name fallback, cancel, and the folder/DB side effects.
- [Switch workspace](./switch-workspace.md) covers roster selection, current-marker moves, and per-workspace files.
- [Add files](./add-files.md) covers the drop path end state, name collisions, non-file rejection, and the un-automatable native picker.
- [Sandbox status](./sandbox-status.md) covers the badge lifecycle and what each state proves about the Boxlite mount.
