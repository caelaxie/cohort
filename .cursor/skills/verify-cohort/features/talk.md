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
- A mock OpenAI-compatible server is listening and `$RUN_ROOT/home/prime/agent/auth.json` contains `openai-completions` pointing at that server (`baseUrl`, `model`, `key`). Chief's reply is produced by embedded Prime Agent using that same file.

- **Composer.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h1 "Chief"`, a Message field, and a `Send` button. It does not show `Add files` or a `Files` rail.
- **Needs login without a key.** If auth.json is missing, the Chief pane includes `Connect a model in Settings`. Send stays disabled until Connect succeeds.
- **Send reply.** Run `... fill --port $PORT --label "Message" --value "hello"`, then `... click --port $PORT --text "Send"`, then `... wait --port $PORT --js "[...document.querySelectorAll('[data-speaker]')].map(el => el.getAttribute('data-speaker')+':'+el.querySelector('p')?.textContent).join('|') === 'owner:hello|bot:hi from Chief'"`. The pane shows You / hello and Chief / hi from Chief.
- **State.** `... state --port $PORT` still has `current` of `chief`. `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT owner_body, bot_body FROM turns ORDER BY created_at, owner_id;"` shows `hello|hi from Chief`.
- **Reopen.** Tear down the instance per `../SKILL.md` cleanup but keep `$RUN_ROOT/home`. Relaunch with the same `COHORT_HOME`. After `doctor`, the Chief pane still shows hello and hi from Chief.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/talk/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/talk/after.png"`.

## Gotchas

- `fill --label` needs Message inside a `<label>` that wraps the textarea.
- Seed `$RUN_ROOT/home/prime/agent/auth.json`, not `~/.prime/agent/auth.json`.
- The mock server must answer `POST /chat/completions` as an OpenAI SSE stream (`text/event-stream` with `finish_reason`). Prime Agent does not accept a single JSON body.
- Bot roster `empty-thread` now expects a composer. Absence of a textarea is a regression.
