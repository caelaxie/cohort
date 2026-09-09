# Switch workspace

Switch workspace lets a user make another roster row current. The main title, files rail, and current indicator follow that row.

## Sub-features

- `switch-select` clicks a non-current roster row and moves `aria-current`.
- `switch-title` updates the level-1 heading to the selected name.
- `switch-files` shows only the selected workspace's files.
- `switch-one-current` keeps exactly one current workspace.

## How to get to it (user POV)

- Choose a workspace name in the left Workspaces list.

## Driving it with control-cohort

Preconditions:

- `control-cohort doctor` is OK.
- Workspaces `Alpha` and `Beta` exist. `Beta` is current.
- Alpha's folder contains `from-alpha.txt`. Beta's folder contains `from-beta.txt`. Seed those files on disk in the run home, then click each workspace once so the rail refreshes (or add them through add-files).

- **Select Alpha.** Choose Alpha. Run `control-cohort click --role button --name Alpha`. Button `Alpha` has `aria-current=page`. Button `Beta` does not. Heading level 1 is `Alpha`.
- **Files follow.** Run `control-cohort expect --role listitem --name from-alpha.txt` and `control-cohort expect --role listitem --name from-beta.txt --gone`.
- **Select Beta.** Choose Beta. Run `control-cohort click --role button --name Beta`. Heading level 1 is `Beta`. Files rail shows `from-beta.txt` only.
- **Roster source of truth.** Run `control-cohort roster`. `current=` is Beta's uuid. Exactly one current row.
- **Proof.** Snapshot and screenshot the Alpha-selected state. Run `control-cohort snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/switch-workspace/alpha.aria.txt` and `control-cohort screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/switch-workspace/alpha.png`. Artifacts show Alpha current and `from-alpha.txt`.

## Gotchas

- Duplicate names make click-by-name unsafe. Use unique names in the run.
- Files written to disk do not appear until the app snapshots state (create, switch, add-files, or box status change). After seeding files outside the UI, click another workspace then back.
- Switching remounts the sandbox. The badge may flicker through `Sandbox starting`. Do not treat that flicker as a switch failure.
