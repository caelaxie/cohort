# Files rail

The files rail is a look-only list of the current workspace's regular files. Nested files show as relative paths. The rail is hidden when nothing is current.

## Sub-features

- `files-visible` shows heading Files whenever a workspace is current, including an empty folder.
- `files-hidden` hides the rail when the roster is empty / nothing is current.
- `files-names` lists regular files, including dotfiles, sorted by relative path.
- `files-nested` shows `dir/name` rather than a tree.
- `files-readonly` has no open/edit/delete controls on the names.

## How to get to it (user POV)

- Create or select a workspace; the right column appears.
- Add files (see add-files); names show in the rail.
- Switch workspace; the list is replaced by the other folder's names.

## Driving it with control-cohort

Preconditions:

- `control-cohort doctor` is OK.
- For the hidden-rail case, start from an empty roster.
- For the populated case, workspace `Alpha` is current and contains `a.txt` and `drafts/b.md`.

- **Hidden when empty.** On an empty roster, run `control-cohort expect --role heading --name Files --level 2 --gone`.
- **Empty current folder.** Create `Alpha` with no files. Run `control-cohort expect --role heading --name Files --level 2`. The rail is present with no listitems.
- **Names after add.** Add `a.txt` through add-files (or seed the file then switch away and back). Run `control-cohort expect --role listitem --name a.txt`.
- **Nested path.** After `drafts/b.md` exists in the folder and the app has snapshotted, run `control-cohort expect --role listitem --name "drafts/b.md"`. There is no expandable folder row.
- **Look only.** Snapshot the rail. Run `control-cohort snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/files-rail/rail.aria.txt`. Listitems have no buttons. Clicking a name must not open an editor (no new window, no heading change).
- **Proof.** Screenshot the populated rail. Run `control-cohort screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/files-rail/rail.png`. The image shows Files, `a.txt`, and `drafts/b.md` with Alpha current.

## Gotchas

- The rail mounts only when `files` is present on app state (a current workspace). Empty current still mounts the rail.
- Symlinks in the folder are omitted. Do not expect them in the list.
- Sorting is relative-path locale compare, not add order.
- Seeding files on disk without a subsequent switch/add will not refresh the rail.
