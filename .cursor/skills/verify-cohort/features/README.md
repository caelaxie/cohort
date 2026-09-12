# Cohort verification map

This directory is the maintained source for verifying the user-facing behavior of Cohort (Electron desktop app). Read this index before driving the app, then use the matching feature file as the recipe. Launch, doctor, drive, evidence, and cleanup mechanics are in `../SKILL.md`; the helper is `../scripts/cohort-drive.mjs` (run with `node`, from the repo root).

## Baseline preconditions

- Instance launched per `../SKILL.md` with scratch `COHORT_HOME=$RUN_ROOT/home`, `--user-data-dir=$RUN_ROOT/home/electron`, and `REMOTE_DEBUGGING_PORT=$PORT`.
- `doctor` passed and the recorded launch PID is alive.
- `$RUN_ROOT` is under `$TMPDIR/cohort-verify/`. Never use the user's real `~/.cohort`.
- Chief exists. No workspace exists.
- Never drive an instance this verification run did not start.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer exact button text, the Crew heading, `aria-current="page"`, and the `h1` over CSS position.
- Treat every command as literal. Keep quoted names unchanged.
- Observe state with `state`, `snapshot`, and `eval`; mutate only through DOM `click`.
- Chief is a fixture that the app already has. Do not create a workspace to reach home.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof: `snapshot` before/after plus a `screenshot` after, with Chief visible in the `h1`.
- Mutation proof: a read-only second view. Capture `state` JSON and the `state.sqlite` `meta.current_id` row.
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

- [Bot roster](./bot-roster.md) covers Chief on launch, the Crew heading, an empty Chief thread with a Message composer, persistence across reopen, and clicking Chief staying current.
- [Model settings](./model-settings.md) covers the Settings footer, the Settings pane, Chief staying current, and connecting a model already on this Mac.
- [Talk to Chief](./talk.md) covers sending a message on the Chief pane and seeing Chief's reply.
- [Hatch a teammate](./hatch.md) covers naming a bot from Chief's pane, selecting it, talking as that bot, and removing it.
- [Chief coordinates teammates](./coordinate.md) covers assigning a brief from Chief, seeing in-flight work, stopping it, and steering with a later assign.
- [Shared room](./room.md) covers the Room pane, owner picking who answers, speaker identity per line, and 1:1 threads staying separate.
- [Ask first](./approval.md) covers the approval prompt before send, post, buy, or delete, deny as the safe default, and the audit of requested vs decided.
