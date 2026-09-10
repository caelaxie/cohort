# Arena synthesis: bot home

Base: candidate 2 (Hatch is a compile-time constant, first paint is Hatch chrome, `LoadedRoster` is a product type).
Dropout: candidates 1 and 4 stalled with no artifact.
Cross-judge: skipped. All runners were inherit-parent grok-4.6. Parent scored the two complete packages.

## Rubric

1. Hatch cannot be omitted from a loaded roster.
2. First paint is a bot home, not leftover workspaces.
3. Files rail, add-files, and box remount are off this screen.
4. Public IPC is small. Main owns persistence.
5. No dual workspace+bot API.
6. This slice does not talk or hatch.

## Scores

| Criterion         | C2                                         | C3                                            |
| ----------------- | ------------------------------------------ | --------------------------------------------- |
| Hatch unomitabble | Strong. Constant, not a row.               | Weaker. Seeds a Hatch row.                    |
| First paint       | Strong. `openingView()` shows Hatch.       | Weaker. Wordmark shell, no Hatch.             |
| Subtract leftover | Strong.                                    | Strong. Rejects leftover fields in parse.     |
| Small IPC         | Strong. `home` / `setCurrent` / `onState`. | Strong. `roster` / `setCurrent` / `onRoster`. |
| No dual API       | Strong.                                    | Strong.                                       |
| Scope             | Strong.                                    | Strong.                                       |

Base is C2. A future maintainer cannot delete Hatch from sqlite because Hatch is not there.

## Grafts

From C3 into C2:

- `current` is a `BotId`, not a copied `Bot` object.
- `parseRoster` rejects leftover workspace/files/box fields.
- Helpers `rosterBots` and `currentBot`.
- Sidebar heading "Crew".

## Rejected

- C3 loading shell without Hatch. That is still a Hatch-less frame.
- C3 Hatch sqlite seed. A row can be omitted.
- Homogeneous `Bot[]` plus `isHatch`.
- Keeping BoxManager with a skip-remount.

## Verification of the sketch

Empty loaded roster is unrepresentable. `setCurrent` no-ops when already current. Box is not in the module map.
