# Arena synthesis: bot home

Base: candidate 2 (Hatch is a compile-time constant, not a sqlite row).
Cross-judge recommended candidate 1. Parent picked 2.

## Rubric

1. Hatch cannot be omitted from a loaded roster.
2. First paint is a bot home, not leftover workspaces.
3. Files rail, add-files, and box remount are off this screen.
4. Public IPC is small. Main owns persistence.
5. No dual workspace+bot API.
6. This slice does not talk or hatch. Empty thread is a domain value.

## Why C2 over the judge's C1 pick

The judge scored both Strong on Hatch-unomittable, then flagged C1 for needing delete/rename policy on a Hatch row. That leak is the reason C2 wins. A wiped `teammates` table still loads Hatch. Talk widens `EmptyThread`; it does not invent Hatch storage.

## Grafts

From C1: `EmptyThread.messages: readonly []` so a transcript cannot be typed yet.
From C1: `current` is a `BotId`, with `currentBot()` at paint, not a copied `Bot` on the roster.
From C2: leftover `meta.current_uuid` is ignored, never migrated.
From C2: named `hatch` field on `Roster`.
From the prior live branch: first paint is `hatchOnlyRoster()`, not a loading canvas.

## Rejected

- Hatch sqlite row (C1). Identity would be data.
- `Message` and `Thread.messages: Message[]` (C2 types). Too loose for this slice.
- `role: 'lead' | 'teammate'` on the object. `Hatch` vs `Teammate` already discriminates.
- Dual `AppStateDto` + bots.
- Leaving leftover workspace modules unwired. Delete them so tests cannot describe the old home.

## Verification of the sketch

Empty loaded roster is unrepresentable. `select('hatch')` does not write when already current. Box is not in the module map. First paint types as a roster that includes Hatch.
