# Model settings

Settings is a sidebar footer, not a bot. It opens a Settings pane where Hatch can use a model subscription already on this Mac. Launch still shows Hatch. Cohort does not meter a weekly cap.

## Sub-features

- `open-settings` opens the Settings pane from the sidebar footer without changing the current bot.
- `paste-connect` fills a provider password field by its method label. Submitting Connect writes `$COHORT_HOME/prime/agent/auth.json`.
- `probe-without-key` keeps the status at `No model connected` when the scratch home has no usable key.
- `settings-is-not-a-bot` leaves `home()` `current` at `hatch` while Settings is open.

## How to get to it (user POV)

- Launch Cohort. Hatch is current. Settings sits under Crew.
- Click `Settings`.
- Click `Hatch` to return to the crew pane.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- First paint is Crew with Hatch current. Do not treat launch as Settings.
- Launch with those provider env vars unset so probe sees only the scratch home.

- **Launch stays Hatch.** After `doctor`, run `node .cursor/skills/verify-cohort/scripts/cohort-drive.mjs snapshot --port $PORT`. The snapshot shows `h2 "Crew"`, a Hatch button with `aria-current="page"`, `h1 "Hatch"`, and a `Settings` button. It does not show `h1 "Settings"`.
- **Open Settings.** Run `... click --port $PORT --text "Settings"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Settings'"`. The `h1` reads `Settings`. Run `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"`. It prints `"Settings"`. The Hatch row does not have `aria-current`.
- **Settings copy.** The snapshot includes `h2 "Model"` and the paragraph `Hatch uses a subscription you already pay for. Cohort does not meter a weekly cap.` It also includes the probe button `Use a key already on this Mac` and paste labels `xAI`, `OpenAI`, and `Anthropic`.
- **Probe without a key.** Run `... click --port $PORT --text "Use a key already on this Mac"`, then `... wait --port $PORT --js "[...document.querySelectorAll('p')].some(p => p.textContent === 'No model connected')"`. Status stays `No model connected`.
- **Paste connect.** Run `... fill --port $PORT --label "xAI" --value "sk-test"`, then `... click --port $PORT --text "Connect"`. Wait until a `p` reads `grok-4.5`. Then outside the UI: `cat "$RUN_ROOT/home/prime/agent/auth.json"` contains `"xai"` and `"sk-test"`. The owner's `~/.prime/agent/auth.json` is not this file.
- **Settings is not a bot.** Run `... state --port $PORT --path "$RUN_ROOT/evidence/model-settings/state.json"`. `current` is `hatch`, `hatch.name` is `Hatch`, and `others` is `[]`. `sqlite3 "$RUN_ROOT/home/state.sqlite" "SELECT value FROM meta WHERE key='current_id';"` is still `hatch`.
- **Back to Hatch.** Run `... click --port $PORT --text "Hatch"`, then `... wait --port $PORT --js "document.querySelector('h1')?.textContent === 'Hatch'"`. The `h1` reads `Hatch`. Run `... eval --port $PORT --js "document.querySelector('[aria-current=\"page\"]')?.textContent"`. It prints `"Hatch"`.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/model-settings/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/model-settings/after.png"`. Capture Settings open before returning to Hatch, with `h1 "Settings"` and Hatch still current in `state`.

## Gotchas

- Settings is chrome under Crew, not a bot. Clicking it does not change `home()` `current` or the `current_id` row.
- First paint is always Hatch. Wait for `doctor` before asserting the footer status line. The model line is missing until that status has loaded.
- `fill --label` needs the provider label inside a `<label>` that wraps the password input. `xAI` is the xAI field, not the word Connect.
- There are several `Connect` buttons. `click --text "Connect"` hits the first one (xAI).
- When `COHORT_HOME` is set, kernel auth is `$COHORT_HOME/prime/agent/auth.json`, not `~/.prime/agent/auth.json`. Unset `XAI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` on launch or `probe-without-key` does not apply.
- Returning to Hatch uses the Hatch row, not Settings. Settings must not keep `aria-current` after that click.
