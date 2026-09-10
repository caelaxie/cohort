# Bot roster

The home screen is a crew roster. Hatch is the lead bot. The owner can see Hatch on first paint and as current.

## Sub-features

- `roster-home` shows Crew, Hatch, and a Hatch heading.
- `roster-current` marks Hatch with `aria-current=page` when no teammate is current.
- `roster-first-paint` shows Hatch before leftover workspace copy.

## How to get to it (user POV)

- Open Cohort.

## Driving it with control-cohort

Preconditions:

- `control-cohort doctor` is OK.
- Isolated `COHORT_HOME` with no teammate rows.

- **Open home.** Launch. Run `control-cohort expect --role heading --name Crew --level 2`. Run `control-cohort expect --role button --name Hatch --attr aria-current --value page`. Run `control-cohort expect --role heading --name Hatch --level 1`.
- **No leftover copy.** Run `control-cohort expect --text "No workspaces" --gone`. There is no New button and no Add files button.
- **Persistence.** Run `control-cohort roster`. Stdout includes `current=hatch` and `hatch|Hatch`.
- **Proof.** Run `control-cohort snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/bot-roster/home.aria.txt` and `control-cohort screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/bot-roster/home.png`. Both show Cohort, Crew, and Hatch.

## Gotchas

- Hatch is a compile-time constant. It will not appear in the `teammates` table.
- First paint uses `openingView()` so Hatch is visible even before `roster()` returns.
- Talk and hatching are not on this screen. Do not treat a missing composer as a failure of this feature.
