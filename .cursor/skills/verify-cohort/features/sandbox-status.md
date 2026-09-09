# Sandbox status

While a workspace is current, a badge reports the Boxlite box that mounts that folder as `/workspace`. No current workspace means no badge.

## Sub-features

- `sandbox-none` shows no badge on the empty-state window.
- `sandbox-starting` shows `Sandbox starting` after create or switch, before the box is up.
- `sandbox-ready` shows `Sandbox ready` when the box started.
- `sandbox-error` shows `Sandbox error` and an alert with the error text when start fails.
- `sandbox-switch` remounts on switch (starting again, then ready or error).

## How to get to it (user POV)

- Create a workspace or select one. The badge appears in the main header next to the title.
- Clear the roster (empty launch) to see no badge.

## Driving it with control-cohort

Preconditions:

- `control-cohort doctor` is OK.
- Empty roster for `sandbox-none`.
- Boxlite may fail on this machine (missing runtime or `alpine:latest`). Ready and error are both valid observables; do not call ready proven from an error badge.

- **None.** On empty state, run `control-cohort expect --text "Sandbox starting" --gone`, `control-cohort expect --text "Sandbox ready" --gone`, `control-cohort expect --text "Sandbox error" --gone`.
- **Starting then settle.** Create `Alpha`. Run `control-cohort click --role button --name New`, `control-cohort fill --role textbox --name Name --value Alpha`, `control-cohort click --role button --name Create`. Shortly after, one of: `Sandbox starting`, then either `Sandbox ready` or `Sandbox error`. Wait with `control-cohort wait --text "Sandbox ready"` **or** `control-cohort wait --text "Sandbox error"` (whichever appears). Record which one.
- **Error detail.** If the badge is `Sandbox error`, an `alert` is present with the error string. Snapshot it.
- **Proof.** Screenshot the settled badge. Run `control-cohort screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/sandbox-status/badge.png` and `control-cohort snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/sandbox-status/badge.aria.txt`. The artifacts include Alpha and the badge text actually shown.

## Gotchas

- Ready is not implied by a successful create. Create can succeed while the box errors.
- Switching workspaces stops the previous box and starts another; a ready badge can go back to starting.
- Do not treat unit tests of `BoxManager` as proof of the live badge.
- If Boxlite blocks for a long time, wait on the badge text, not a fixed sleep. If it never leaves `Sandbox starting` within the command timeout, report that as the observed state, not as ready.
