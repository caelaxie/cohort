# Add files

Add files copies regular files into the current workspace folder, shows a short notice, and lists the new names on the files rail.

## Sub-features

- `add-button` opens the native open dialog from Add files.
- `add-pick` copies the chosen file and shows `Added 1 file.` (or `Added N files.`).
- `add-cancel` dismisses the dialog and shows `No files added.`
- `add-suffix` keeps the original and writes `name (1).ext` when the name already exists.
- `add-drop` copies files dropped onto the center panel (OS drop, not a synthetic CDP file).

## How to get to it (user POV)

- Choose `Add files` in the center panel, then pick files in the macOS dialog.
- Drop files from Finder onto the center panel (the heading reads `Drop files here` while dragging).
- Add files is absent until a workspace is current.

## Driving it with control-cohort

Preconditions:

- `control-cohort doctor` is OK.
- Workspace `Alpha` is current.
- A regular file exists at `$VERIFY_COHORT_RUN/scratch/notes.txt` with contents `hello` (create that file as verification scaffolding; delete the scratch file in cleanup, not the copied workspace file until run teardown).

- **Button entry.** Choose Add files. Run `control-cohort click --role button --name "Add files"`. The native open dialog appears (not an in-window chooser).
- **Pick file.** Drive the dialog. Run `control-cohort pick-files -- $VERIFY_COHORT_RUN/scratch/notes.txt`. Notice text is `Added 1 file.` Files rail has listitem `notes.txt`. `control-cohort files` includes `notes.txt`. Bytes on disk are `hello`.
- **Cancel dialog.** Choose Add files, then press Escape in the dialog. Run `control-cohort click --role button --name "Add files"` and `control-cohort press --key Escape` if the dialog is key-focusable; otherwise dismiss with the dialog Cancel button via the computer-use driver. Notice becomes `No files added.` The rail still has only the files that were already there.
- **Duplicate name.** Add `notes.txt` again. Notice is `Added 1 file.` Rail contains `notes.txt` and `notes (1).txt`. Original bytes unchanged.
- **Drop entry.** Drag a real Finder file onto the center panel until the heading reads `Drop files here`, then drop. Same notice and rail rules as pick. If Finder drop cannot be performed, record `add-drop` as unreachable with that reason. Do not call `window.cohort.addFiles`.
- **Proof.** Capture the successful pick. Run `control-cohort snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/add-files/after.aria.txt` and `control-cohort screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/add-files/after.png`. Artifacts show `Added 1 file.` and `notes.txt`. Keep a copy of `control-cohort files` output next to them.

## Gotchas

- The picker is `dialog.showOpenDialog` (native). Playwright file choosers do not see it.
- `pick-files` needs macOS Automation for System Events. If osascript errors, the path is unreachable until that permission exists.
- Directories are rejected (`only regular files can be added`). A mixed pick can yield `Added 1 of 2 files.`
- Cancel with zero paths shows `No files added.` (`total === 0`), not an error alert.
- Synthetic drops from CDP do not copy: `webUtils.getPathForFile` needs a real OS file.
