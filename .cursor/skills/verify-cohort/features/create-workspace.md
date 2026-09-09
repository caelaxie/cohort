# Create a workspace

Create workspace lets a user start from an empty roster, open a name form from New, save a named or unnamed workspace as current, and cancel an unfinished draft.

## Sub-features

- `create-empty` shows No workspaces and Create a workspace when the roster is empty.
- `create-open` opens the Name field from New.
- `create-named` persists a trimmed display name, selects it, and opens the files rail.
- `create-blank` uses the uuid as the display name when Name is empty or whitespace.
- `create-cancel` discards the draft via Cancel or Escape without writing a workspace.
- `create-second` creates another workspace and makes it the only current one.

## How to get to it (user POV)

- Choose `New` in the Workspaces sidebar.
- Submit with `Create` or the form's enter key.
- Leave Name blank for a uuid-named workspace.
- Choose `Cancel`, or press Escape while the Name field is focused, to close the form.

## Driving it with control-cohort

Preconditions:

- `control-cohort doctor` is OK.
- Roster is empty (`control-cohort roster` prints `current=` and no `uuid|name` rows).
- No workspace is titled `Alpha`.

- **Empty state.** Read the window. Run `control-cohort expect --text "No workspaces"` and `control-cohort expect --role heading --name Cohort --level 1`. The Files heading is absent. Snapshot this state.
- **Open form.** Choose New. Run `control-cohort click --role button --name New`. A textbox named `Name` appears with buttons `Create` and `Cancel`.
- **Cancel draft.** Type `Discard me` and choose Cancel. Run `control-cohort fill --role textbox --name Name --value "Discard me"` and `control-cohort click --role button --name Cancel`. The Name textbox is gone (`control-cohort expect --role textbox --name Name --gone`). Roster is still empty. `control-cohort roster` still has no rows.
- **Escape draft.** Open New again, type `Also discard`, press Escape. Run `control-cohort click --role button --name New`, `control-cohort fill --role textbox --name Name --value "Also discard"`, `control-cohort press --key Escape`. Roster remains empty.
- **Named create.** Open New, enter `Alpha`, choose Create. Run `control-cohort click --role button --name New`, `control-cohort fill --role textbox --name Name --value Alpha`, `control-cohort click --role button --name Create`. The Create label may briefly read `Creating…`. Then: heading level 1 is `Alpha`; button `Alpha` has `aria-current=page`; text `No workspaces` is gone; heading `Files` is present; center copy includes `Files you add land in this workspace.`
- **Confirm persistence.** Run `control-cohort roster`. Stdout has `current=<uuid>` and a line `<uuid>|Alpha`. Folder `<home>/workspaces/<uuid>/` exists.
- **Second workspace.** Create `Beta` the same way. Exactly one `aria-current=page` remains, on `Beta`. Roster lists both names. Heading level 1 is `Beta`.
- **Blank name.** Create with Name empty. Run `control-cohort click --role button --name New` then `control-cohort click --role button --name Create`. The new roster button's name is a uuid string, and that same string is the h1.
- **Proof.** Capture the named-create result. Run `control-cohort snapshot --path .cursor/skills/verify-cohort/artifacts/<id>/create-workspace/after.aria.txt` and `control-cohort screenshot --path .cursor/skills/verify-cohort/artifacts/<id>/create-workspace/after.png`. Both show Cohort, Workspaces, Alpha current, and the Files rail.

## Gotchas

- Name is trimmed. Whitespace-only is treated as empty and stored as the uuid.
- Duplicate display names are allowed. Two `Alpha` buttons cannot be addressed by name alone.
- `New` stays visible while the form is open.
- A sandbox badge (`Sandbox starting` / `ready` / `error`) may appear after create. That is not create proof; see sandbox-status.
- sqlite plus the uuid folder are required. The heading alone is not enough.
