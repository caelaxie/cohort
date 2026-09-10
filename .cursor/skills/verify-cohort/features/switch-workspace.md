# Switch workspace

Switch workspace lets a user click any workspace in the sidebar to make it current: the header, files rail, and sandbox all follow the selection.

## Sub-features

- `switch-select` makes the clicked workspace current.
- `switch-marker` moves `aria-current="page"` to the clicked row.
- `switch-files` swaps the files rail to the newly current workspace's files.
- `switch-sandbox` remounts the sandbox onto the new workspace folder.

## How to get to it (user POV)

- Click a workspace name in the Workspaces sidebar.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions hold.
- `Verify Alpha` and `Verify Beta` exist (create them per `create-workspace.md`); `Verify Alpha` contains a file (see `add-files.md`), `Verify Beta` is empty. `Verify Beta` is current.

- **Select Alpha.** Click `Verify Alpha`. Run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs click --port $PORT --text "Verify Alpha"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Verify Alpha'"`. The `h1` reads `Verify Alpha`.
- **Marker.** Run `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"`. It prints `"Verify Alpha"`.
- **Files rail.** Run `... snapshot --port $PORT`. The `Files` rail lists Alpha's file and none of Beta's (Beta has none).
- **Sandbox.** The badge returns to `Sandbox ready` after the remount: `... wait --port $PORT --timeout 90000 --js "[...document.querySelectorAll('header span')].some(s => /Sandbox (ready|error)/.test(s.textContent))"`.
- **Persistence.** `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT value FROM meta WHERE key='current_uuid';"` equals Alpha's UUID, and `... state --port $PORT` marks Alpha `current: true`.
- **Proof.** `... screenshot --port $PORT --path "$RUN_ROOT/evidence/switch-workspace/alpha.png"` with the `h1`, marker, and rail visible.

## Gotchas

- Clicking the already-current workspace is a no-op remount; always switch between two distinct fixtures.
- Right after switching, the badge can show `Sandbox starting`; wait for it to settle before screenshotting.
- The files rail is per-workspace: if Alpha's file appears while Beta is current, that is a bug — capture state and stop.
