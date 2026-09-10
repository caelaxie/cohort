# Create a workspace

Create workspace lets a user add a named workspace from the sidebar, makes it current immediately, and gives it a real folder and roster row on disk.

## Sub-features

- `create-open` opens the draft form from the `New` button.
- `create-named` persists a trimmed name and selects the workspace.
- `create-blank` falls back to the UUID as the name when the draft is empty.
- `create-cancel` discards a draft with `Cancel` or Escape.

## How to get to it (user POV)

- Click `New` in the Workspaces sidebar, type a name, click `Create` (or press Enter).
- Click `New`, then click `Cancel` or press Escape to abandon the draft.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- No workspace named `Verify Alpha` exists in the scratch home.

- **Open form.** Click `New`. Run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs click --port $PORT --text "New"`. A form with a `Name` input appears; the input is focused.
- **Enter name.** Type `Verify Alpha`. Run `... fill --port $PORT --label Name --value "Verify Alpha"`. The input shows the value.
- **Submit.** Click `Create`. Run `... click --port $PORT --text "Create"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Verify Alpha'"`. The `h1` reads `Verify Alpha`, the sidebar button for it has `aria-current="page"`, and the Add-files card appears.
- **Confirm persistence.** Run `... state --port $PORT --path "$RUN_ROOT/evidence/create-workspace/state.json"` — the workspace is listed with `current: true`. Then outside the UI: `ls "$RUN_ROOT/home/workspaces/<uuid>/"` exists and `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT name FROM workspaces;"` shows `Verify Alpha`, and `meta.current_uuid` equals its UUID.
- **Blank name.** Click `New`, click `Create` without typing. The new workspace's name is its own UUID (snapshot shows a UUID-shaped button).
- **Cancel.** Click `New`, type `Discard Me`, press Escape: `... key --port $PORT --key Escape`. The form disappears and no `Discard Me` button exists: `... eval --port $PORT --js "!!document.querySelector('form')"` prints `false`.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/create-workspace/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/create-workspace/after.png"`. Both show `Verify Alpha` as current.

## Gotchas

- Names are trimmed on create; assert the rendered sidebar text, not the draft value.
- The empty roster (`No workspaces`) is replaced by the list only after the first create resolves — `wait` for the `h1`, don't assume timing.
- Creating a workspace also remounts the sandbox; the badge may read `Sandbox starting` right after create. That is covered by `sandbox-status.md`, not a create failure.
- `create-blank` and the cancel fixture leave no durable state beyond the created workspace; cleanup removes the whole scratch home, so no per-fixture teardown is needed.
