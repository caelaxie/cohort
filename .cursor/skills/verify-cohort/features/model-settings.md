# Model settings

Settings is a sidebar footer, not a bot. It opens a Settings pane where the owner connects their own OpenAI-compatible chat completions endpoint. Launch still shows Chief. Cohort does not meter a weekly cap.

## Sub-features

- `open-settings` opens the Settings pane from the sidebar footer without changing the current bot.
- `cmd-comma` opens Settings from the Chief pane via Cmd+, (Ctrl+, on non-Mac).
- `paste-connect` fills Base URL, Model, and API key by those labels. Submitting Connect writes `$COHORT_HOME/prime/agent/auth.json`.
- `probe-without-key` keeps the status at `No model connected` when the scratch home has no usable key.
- `settings-is-not-a-bot` leaves `home()` `current` at `chief` while Settings is open.

## How to get to it (user POV)

- Launch Cohort. Chief is current. Settings sits under Crew.
- Click `Settings`.
- Press Cmd+, (Ctrl+, on non-Mac) from the Chief pane.
- Click `Chief` to return to the crew pane.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- First paint is Crew with Chief current. Do not treat launch as Settings.
- Launch with `XAI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` unset so probe sees only the scratch home.

- **Launch stays Chief.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h2 "Crew"`, a Chief button with `aria-current="page"`, `h1 "Chief"`, and a `Settings` button. It does not show `h1 "Settings"`.
- **Open Settings.** Run `... click --port $PORT --text "Settings"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Settings'"`. The `h1` reads `Settings`. Run `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"`. It prints `"Settings"`. The Chief row does not have `aria-current`.
- **Cmd+comma.** Click `Chief` so the `h1` is `Chief`. Run `... eval --port $PORT --js "window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true, cancelable: true }))"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Settings'"`. The `h1` reads `Settings`. `home()` `current` stays `chief`.
- **Settings copy.** The snapshot includes `h2 "Model"` and the paragraph `Connect your own OpenAI-compatible chat completions endpoint. Cohort does not meter a weekly cap.` It also includes the probe button `Use a key already on this Mac` and the labels `Base URL`, `Model`, and `API key`. It does not include three vendor Connect buttons.
- **Probe without a key.** Run `... click --port $PORT --text "Use a key already on this Mac"`, then `... wait --port $PORT --js "[...document.querySelectorAll('p')].some(p => p.textContent === 'No model connected')"`. Status stays `No model connected`.
- **Paste connect.** Run `... fill --port $PORT --label "Base URL" --value "http://127.0.0.1:11434/v1"`, then `... fill --port $PORT --label "Model" --value "llama3.1:8b"`, then `... fill --port $PORT --label "API key" --value "sk-test"`, then `... click --port $PORT --text "Connect"`. Wait until a `p` reads `llama3.1:8b`. Then outside the UI: `cat "$RUN_ROOT/home/prime/agent/auth.json"` contains `"openai-completions"` and `"http://127.0.0.1:11434/v1"`. The owner's `~/.prime/agent/auth.json` is not this file.
- **Settings is not a bot.** Run `... state --port $PORT --path "$RUN_ROOT/evidence/model-settings/state.json"`. `current` is `chief`, `chief.name` is `Chief`, and `others` is `[]`. `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT value FROM meta WHERE key='current_id';"` is still `chief`.
- **Back to Chief.** Run `... click --port $PORT --text "Chief"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Chief'"`. The `h1` reads `Chief`. Run `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"`. It prints `"Chief"`.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/model-settings/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/model-settings/after.png"`. Capture Settings open before returning to Chief, with `h1 "Settings"` and Chief still current in `state`.

## Gotchas

- Settings is chrome under Crew, not a bot. Clicking it does not change `home()` `current` or the `current_id` row.
- First paint is always Chief. Wait for `doctor` before asserting the footer status line. The model line is missing until that status has loaded.
- `fill --label` needs the field name inside a `<label>` that wraps the input. `Base URL`, `Model`, and `API key` are those fields.
- There is one `Connect` button. It submits the form. The `xAI` and `OpenAI` buttons only fill Base URL and Model. They do not connect.
- When `COHORT_HOME` is set, kernel auth is `$COHORT_HOME/prime/agent/auth.json`, not `~/.prime/agent/auth.json`. Unset `XAI_API_KEY` and `OPENAI_API_KEY` on launch or `probe-without-key` does not apply.
- Returning to Chief uses the Chief row, not Settings. Settings must not keep `aria-current` after that click.
- Cmd+, in this recipe is a synthetic `KeyboardEvent` with `metaKey: true`. That hits the renderer listener. It does not click the application menu item.
