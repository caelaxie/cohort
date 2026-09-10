# Add files

Add files copies files the user drops onto the main panel (or picks from disk) into the current workspace folder, shows a notice, and lists them in the files rail.

## Sub-features

- `add-copy` copies a file into the workspace folder and shows `Added 1 file.`
- `add-rail` lists the added file in the `Files` rail.
- `add-collision` renames a second copy of the same name to `name (1).ext`.
- `add-reject` refuses directories and non-regular files with an error notice.

## How to get to it (user POV)

- Drag files onto the main panel's Add-files card.
- Click `Add files` and pick files in the native open dialog.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions hold; `Verify Alpha` exists and is current.
- A probe file exists outside the scratch home, e.g. `echo "hello cohort verification" > "$RUN_ROOT/probe-file.txt"`.

- **Copy via the drop path.** The renderer's drop handler resolves dropped `File` objects to paths and invokes `window.cohort.addFiles(paths)`; the picker ends in the same IPC after the native dialog. Drive that exact call with explicit paths: `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs eval --port $PORT --js "window.cohort.addFiles(['$RUN_ROOT/probe-file.txt'])"`. It prints `{"copied":1,"total":1}`.
- **Notice.** Run `... wait --port $PORT --js "document.body.textContent.includes('Added 1 file.')"`. The notice `Added 1 file.` is visible.
- **Rail.** Run `... wait --port $PORT --js "[...document.querySelectorAll('li')].some(li => li.textContent.trim() === 'probe-file.txt')"`. The `Files` rail lists `probe-file.txt`.
- **On disk.** `ls "$RUN_ROOT/home/workspaces/<alpha-uuid>/probe-file.txt"` exists and `cmp` matches the source byte for byte.
- **Collision.** Add the same probe again. The result is `{"copied":1,"total":1}` and the folder now also contains `probe-file (1).txt`; the rail lists both names.
- **Reject.** Run `... eval --port $PORT --js "window.cohort.addFiles(['$RUN_ROOT'])"` (a directory). It prints an error (`only regular files can be added`) and the notice shows that error text.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/add-files/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/add-files/after.png"` showing the notice and both rail entries.

## Gotchas

- Never click `Add files` in automation: it opens a modal native picker that CDP cannot dismiss and the run hangs until a human closes it. Assert the button exists via `snapshot`; prove the pipeline via the drop path above.
- A synthetic `new File()` in the page does not work: `webUtils.getPathForFile` returns an empty path for files that did not come from a real drop or picker. Explicit paths to `addFiles` are the honest equivalent of a completed drop.
- The notice is transient UI state, not proof of the copy. Always confirm the file in the workspace folder on disk.
- `addFiles` with no current workspace returns `{"copied":0,"total":0,"error":"no current workspace"}` — if you see that, the fixture setup is wrong, not the feature.
