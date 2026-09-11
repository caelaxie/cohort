# Talk to Hatch

The Hatch pane is a teammate thread. The owner types in Message and clicks Send. Hatch replies. The thread is still there after reopen against the same scratch home.

## Sub-features

- `composer` shows a Message field and a Send button on the Hatch pane.
- `needs-login` keeps Send disabled until a model is connected and shows `Connect a model in Settings`.
- `send-reply` posts the owner body and paints Hatch's reply from the connected completions endpoint.
- `persist-reopen` keeps both messages after quit and relaunch against the same scratch home.

## How to get to it (user POV)

- Launch Cohort. Hatch is current. Type in Message. Click Send.
- Open Settings only to connect a model, then click Hatch to return.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- Launch with `XAI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` unset.
- A mock OpenAI-compatible server is listening and `$RUN_ROOT/home/prime/agent/auth.json` contains `openai-completions` pointing at that server (`baseUrl`, `model`, `key`).

- **Composer.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h1 "Hatch"`, a Message field, and a `Send` button. It does not show `Add files` or a `Files` rail.
- **Needs login without a key.** If auth.json is missing, the Hatch pane includes `Connect a model in Settings`. Send stays disabled until Connect succeeds.
- **Send reply.** Run `... fill --port $PORT --label "Message" --value "hello"`, then `... click --port $PORT --text "Send"`, then `... wait --port $PORT --js "[...document.querySelectorAll('[data-speaker]')].map(el => el.getAttribute('data-speaker')+':'+el.querySelector('p')?.textContent).join('|') === 'owner:hello|bot:hi from Hatch'"`. The pane shows You / hello and Hatch / hi from Hatch.
- **State.** `... state --port $PORT` still has `current` of `hatch`. `sqlite3 "$RUN_ROOT/home/talk.sqlite" "SELECT author, body FROM messages ORDER BY rowid;"` shows `owner|hello` and `bot|hi from Hatch`.
- **Reopen.** Tear down the instance per `../SKILL.md` cleanup but keep `$RUN_ROOT/home`. Relaunch with the same `COHORT_HOME`. After `doctor`, the Hatch pane still shows hello and hi from Hatch.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/talk/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/talk/after.png"`.

## Gotchas

- `fill --label` needs Message inside a `<label>` that wraps the textarea.
- Seed `$RUN_ROOT/home/prime/agent/auth.json`, not `~/.prime/agent/auth.json`.
- The mock server must answer `POST /chat/completions` with `choices[0].message.content`.
- Bot roster `empty-thread` now expects a composer. Absence of a textarea is a regression.
