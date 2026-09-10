# Sandbox status

Sandbox status is the header badge that tells the user whether the current workspace's Boxlite micro-VM is mounted: nothing when no workspace is selected, then `Sandbox starting`, `Sandbox ready`, or `Sandbox error`.

## Sub-features

- `sandbox-none` shows no badge when no workspace is current.
- `sandbox-ready` reaches `Sandbox ready` after a workspace becomes current.
- `sandbox-error` surfaces the Boxlite error text in a `p[role="alert"]` when the mount fails.

## How to get to it (user POV)

- Look at the right end of the main panel header after selecting a workspace.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions hold; no workspace exists yet.

- **No badge.** Run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs eval --port $PORT --js "[...document.querySelectorAll('header span')].map(s => s.textContent)"`. It prints `[]` (no badge without a current workspace).
- **Starting.** Create `Verify Alpha` per `create-workspace.md` and immediately run `... state --port $PORT`. `boxStatus` is `starting` (or already `running` on a warm machine).
- **Ready.** Run `... wait --port $PORT --timeout 90000 --js "[...document.querySelectorAll('header span')].some(s => /Sandbox (ready|error)/.test(s.textContent))"`, then `... state --port $PORT --path "$RUN_ROOT/evidence/sandbox-status/state.json"`. Expect `boxStatus: "running"` and the badge text `Sandbox ready`.
- **Ready means mounted.** `Sandbox ready` proves Boxlite started an `alpine:latest` VM, mounted the workspace folder at `/workspace`, and ran `true` in it. No further guest-side assertion exists in the UI.
- **Error path (only if it happens).** If the badge reads `Sandbox error`, capture `... eval --port $PORT --js "document.querySelector('p[role=alert]')?.textContent"` and the screenshot. That is a product finding (usually the shared `~/.boxlite` runtime), not a harness failure.
- **Proof.** `... screenshot --port $PORT --path "$RUN_ROOT/evidence/sandbox-status/ready.png"` with the badge visible.

## Gotchas

- The Boxlite runtime (`~/.boxlite`) and its image cache are shared machine state. A cold machine may pull the alpine image on first run — allow the full 90 s wait before judging.
- Do not try to force the error path by corrupting `~/.boxlite`; that damages the user's real setup. Observe it only if it occurs.
- The badge follows workspace selection; after every create or switch, re-wait for it to settle before concluding anything.
