# Shared room

The Room pane is one thread for the owner, Chief, and hatched bots. The owner picks who answers. Each line shows who spoke. 1:1 bot threads stay on their own panes.

## Sub-features

- `open-room` opens Room from Crew without changing the current bot.
- `owner-picks` sends with To set to Chief or a teammate; only that bot replies.
- `speaker-identity` paints You / Chief / teammate on each line.
- `persist-reopen` keeps room lines after quit and relaunch against the same scratch home.
- `one-to-one-intact` leaves Chief and teammate 1:1 turns unchanged.

## How to get to it (user POV)

- Launch Cohort. Click Room under Crew. Choose To, type a Message, click Send.
- Click Chief or a teammate to leave the room and read that bot's own thread.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- A teammate exists (run [Hatch a teammate](./hatch.md) `hatch-named`).
- For a completed send, launch with the same mock OpenAI-compatible server and `$RUN_ROOT/home/prime/agent/auth.json` setup as [Talk to Chief](./talk.md).

- **Open room.** Run `... click --port $PORT --text "Room"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Room'"`. Snapshot shows `h1 "Room"`, a To field, a Message field, and a `Send` button. `... state --port $PORT` still has the previous `current` (Room is not a bot).
- **Owner picks Chief.** With To on Chief, `... fill --port $PORT --label "Message" --value "hello room"`, then `... click --port $PORT --text "Send"`, then `... wait --port $PORT --js "[...document.querySelectorAll('[data-speaker]')].map(el => el.getAttribute('data-speaker')+':'+el.querySelector('p')?.textContent).join('|') === 'owner:hello room|chief:hi from Chief'"`. Speaker labels are You then Chief.
- **Owner picks teammate.** Set To to Scout, send `scout, take the outline`. Wait until `data-speaker` includes `scout`. Speaker label for that reply is Scout.
- **Persist.** `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT speaker_kind, speaker_bot_id, body FROM room_lines ORDER BY n;"` includes `owner||hello room`, `bot|chief|hi from Chief`, and a Scout reply. `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT bot_id FROM turns;"` does not gain room rows.
- **One-to-one intact.** Click Chief. That pane is not the room transcript. Send on Chief still writes `turns` for `chief` only.
- **Reopen.** Tear down the instance per `../SKILL.md` cleanup but keep `$RUN_ROOT/home`. Relaunch, click Room. The room lines are still there.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/room/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/room/after.png"`.

## Gotchas

- Room is a Crew item, not a roster bot. `state` `current` does not become `room`.
- To is required. There is no silent fan-out to every bot.
- Assign on Chief is still 1:1 on the teammate thread, not a room line.
- `fill --label` needs Message inside a `<label>` that wraps the textarea.
- Room itself has no Post or Buy control. An Ask first prompt appears only when a bot asks to send, post, buy, or delete.
