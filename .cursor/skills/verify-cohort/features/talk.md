# Talk to Chief

The Chief pane is a teammate thread. The owner types in Message and clicks Send. Chief replies. The thread is still there after reopen against the same scratch home.

## Sub-features

- `composer` shows a Message field and a Send button on the Chief pane.
- `needs-login` keeps Send disabled until a model is connected and shows `Connect a model in Settings`.
- `send-reply` posts the owner body and paints Chief's reply from embedded Prime Agent.
- `persist-reopen` keeps both messages after quit and relaunch against the same scratch home.

## How to get to it (user POV)

- Launch Cohort. Chief is current. Type in Message. Click Send.
- Open Settings only to connect a model, then click Chief to return.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- Launch with `XAI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` unset.
- For `send-reply`, connect local Ollama first (`../SKILL.md` **Model provider**, [Model settings](./model-settings.md) `paste-connect`), then click `Chief`.

- **Composer.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h1 "Chief"`, a Message field, and a `Send` button. It does not show `Add files` or a `Files` rail.
- **Needs login without a key.** If auth.json is missing, the Chief pane includes `Connect a model in Settings`. Send stays disabled until Connect succeeds.
- **Send enabled.** After Connect and returning to Chief, `... wait --port $PORT --js "[...document.querySelectorAll('button')].some(b => b.textContent==='Send' && !b.disabled)"`.
- **Send reply.** Run `... fill --port $PORT --label "Message" --value "Reply with only the word pong."`, then `... click --port $PORT --text "Send"`, then `... wait --port $PORT --timeout 120000 --js "[...document.querySelectorAll('[data-speaker=\"bot\"] p')].some(p => /pong/i.test(p.textContent||''))"`. The pane shows You / that prompt and Chief / a reply containing `pong`. If the wait fails, `eval` `document.querySelector('p[role="alert"]')?.textContent` and screenshot. `turn failed` is a kernel miss, not a slow model.
- **State.** `... state --port $PORT` still has `current` of `chief`. `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT owner_body, bot_body FROM turns ORDER BY created_at, owner_id;"` has owner `Reply with only the word pong.` and a bot body that contains `pong`.
- **Reopen.** Tear down the instance per `../SKILL.md` cleanup but keep `$RUN_ROOT/home`. Relaunch with the same `COHORT_HOME`. After `doctor`, the Chief pane still shows that turn.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/talk/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/talk/after.png"`.

## Gotchas

- `fill --label` needs Message inside a `<label>` that wraps the textarea.
- Connect through Settings. Do not seed `auth.json`. Do not start a mock completions server.
- The owner's `~/.prime/agent/auth.json` is not the scratch file.
- Bot roster `empty-thread` now expects a composer. Absence of a textarea is a regression.
