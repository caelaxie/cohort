# Hatch a teammate

From the Chief pane the owner names a bot and clicks Hatch. The new teammate appears under Crew, can be selected, and has its own talk thread. Remove puts the roster back.

## Sub-features

- `hatch-named` creates a roster entry from the Name field on the Chief pane.
- `select-hatched` opens that bot's pane and empty thread.
- `talk-as-hatched` sends on that pane and paints the reply as that bot.
- `remove-hatched` removes the teammate and returns current to Chief.

## How to get to it (user POV)

- Launch Cohort. Chief is current. Type a name. Click Hatch.
- Click the new name under Crew to talk. Click Remove to undo.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- The scratch home has not been given a teammate row.
- For `talk-as-hatched`, launch with the same mock OpenAI-compatible server and `$RUN_ROOT/home/prime/agent/auth.json` setup as [Talk to Chief](./talk.md).

- **Hatch named.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h1 "Chief"`, a Name field, and a `Hatch` button. Run `... fill --port $PORT --label "Name" --value "Scout"`, then `... click --port $PORT --text "Hatch"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Scout'"`.
- **State.** `... state --port $PORT` has `current` of `scout` and `others` including `{ id: 'scout', name: 'Scout' }`. `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT id, name FROM teammates;"` shows `scout|Scout`.
- **Select hatched.** Run `... click --port $PORT --text "Chief"`, then `... click --port $PORT --text "Scout"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Scout'"`. The pane shows a `Remove` button and a Message composer. It does not show Hatch.
- **Talk as hatched.** With the mock server from Talk to Chief, run `... fill --port $PORT --label "Message" --value "hello"`, then `... click --port $PORT --text "Send"`, then `... wait --port $PORT --js "[...document.querySelectorAll('[data-speaker]')].map(el => el.getAttribute('data-speaker')+':'+el.querySelector('p')?.textContent).join('|') === 'owner:hello|bot:hi from Chief'"`. Speaker label for the bot line is Scout (`... eval --port $PORT --js "[...document.querySelectorAll('[data-speaker=\"bot\"] span')].map(el => el.textContent).join('') === 'Scout'"`). `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT bot_id, owner_body, bot_body FROM turns;"` is `scout|hello|hi from Chief`.
- **Remove hatched.** Run `... click --port $PORT --text "Remove"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Chief'"`. `... state --port $PORT` has `current` of `chief` and `others` of `[]`. `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT id FROM teammates;"` is empty.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/hatch/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/hatch/after.png"`.

## Gotchas

- Hatch is on the Chief pane, not the Crew sidebar. Click Chief before looking for the Name field.
- After a teammate exists, Chief also shows To / Brief / Assign. That is coordination, not hatch.
- Hatch does not need a connected model. Talk as the hatched bot does.
- The mock reply body may still say `hi from Chief` if the server is the Talk to Chief fixture. Assert `bot_id` and the Scout speaker label, not the mock wording.
- `fill --label` needs Name inside a `<label>` that wraps the input.
