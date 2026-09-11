# Chief coordinates teammates

From the Chief pane the owner assigns a brief to a hatched teammate. That brief is a talk turn on the teammate's thread. While it runs, Chief shows the work and Stop interrupts it. No send/post/buy/delete surface.

## Sub-features

- `assign-teammate` sends a brief to a hatched bot from Chief without leaving Chief.
- `see-running` shows that bot as working, with the brief, while the turn is in flight.
- `stop-running` interrupts the in-flight turn and writes nothing to that bot's thread.
- `steer-teammate` assigns again to the same bot after the first turn closes.

## How to get to it (user POV)

- Launch Cohort. Hatch a teammate. Click Chief. Choose To, type a Brief, click Assign.
- Read the working line on Chief. Click Stop to interrupt, or open the teammate to read the reply.
- Assign again to steer.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- A teammate exists (run [Hatch a teammate](./hatch.md) `hatch-named`, then click Chief).
- For a completed assign, launch with the same mock OpenAI-compatible server and `$RUN_ROOT/home/prime/agent/auth.json` setup as [Talk to Chief](./talk.md).

- **Assign teammate.** After returning to Chief, `snapshot` shows `h1 "Chief"`, a To field, a Brief field, and an `Assign` button. Run `... fill --port $PORT --label "Brief" --value "draft the outline"`, then `... click --port $PORT --text "Assign"`.
- **See running.** While the turn is in flight, `... wait --port $PORT --js "!!document.querySelector('[role=status]')"` and the status text includes Scout and `draft the outline`. Crew shows `working` on Scout. `... eval --port $PORT --js "window.cohort.coordination().then(c => JSON.stringify(c))"` includes `scout` and the brief. Chief's thread stays empty: `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT bot_id FROM turns WHERE bot_id = 'chief';"` is empty.
- **Steer or finish.** After the mock reply, Scout's thread has the brief. `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT bot_id, owner_body FROM turns;"` includes `scout|draft the outline`. Assign again with a new brief to steer.
- **Stop running.** Start an assign that stays in flight, then `... click --port $PORT --text "Stop"`. Status clears. That in-flight brief is not a turns row.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/coordinate/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/coordinate/after.png"`.

## Gotchas

- Assign is on the Chief pane, after Hatch. Click Chief after hatching.
- Assign needs a connected model. Stop does not.
- Assign is not the shared room. The work still lives on the teammate's own thread. Room is a separate Crew item.
- There is no Post, Buy, or Approve button. Remove is roster-only.
