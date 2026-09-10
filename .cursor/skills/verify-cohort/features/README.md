# Cohort verification map

This directory is the maintained source for verifying the user-facing behavior of the Cohort Electron window. Read the index before driving the app, then use the matching feature file as the recipe.

The shipped surface is the crew roster with Hatch as lead. Leftover workspace recipes below are history until rewritten.

## Baseline preconditions

- Launch with `control-cohort launch` so `COHORT_HOME` is the run `home/` and Electron uses the run `electron-profile/`.
- `control-cohort doctor` reports title `Cohort`, Workspaces painted, and home not `~/.cohort`.
- Start from an empty roster unless a recipe seeds workspaces.
- Never drive an instance this run did not launch. Never open the Vite URL in Chrome.
- Put `control-cohort` on your command path as `.cursor/skills/verify-cohort/scripts/control-cohort`.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or coordinates.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run window actions through `control-cohort` (click / fill / press / expect / snapshot / screenshot).
- Prove disk side effects with `control-cohort roster` and `control-cohort files`.
- Restore nothing to `~/.cohort`. Cleanup removes the run dir only.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with Cohort and Workspaces visible.
- Mutation proof includes sqlite (`roster`) and/or files on disk (`files`).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-cohort` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Bot roster](./bot-roster.md) covers Hatch as the lead bot on the home screen.
- [Create a workspace](./create-workspace.md) leftover. Not on the shipped home.
- [Switch workspace](./switch-workspace.md) leftover. Not on the shipped home.
- [Add files](./add-files.md) leftover. Not on the shipped home.
- [Files rail](./files-rail.md) leftover. Not on the shipped home.
- [Sandbox status](./sandbox-status.md) leftover. Not on the shipped home.
