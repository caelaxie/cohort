# Ask first

When a bot wants to send, post, buy, or delete, Cohort asks first. The owner must Approve. Deny, Escape, and dismissing the prompt are the safe default and leave no side effect. The audit stores what was requested and what was decided.

## Sub-features

- `pending-visible` shows the Ask first dialog with the bot, action class, and summary.
- `deny-default` treats Deny, Escape, and backdrop dismiss as deny.
- `approve-vs-deny` writes requested vs decision to the approval audit.
- `no-side-effect` leaves the simulated action unexecuted unless Approve is clicked.

## How to get to it (user POV)

- A bot asks to send, post, buy, or delete. The Ask first dialog appears over the current pane. Click Deny or Approve, or press Escape.

## Driving it with cohort-drive

Preconditions:

- Baseline preconditions from `README.md` hold.
- Prime stays without tools. Create a pending request by evaluating `window.cohort.requestApproval` (that is the tool-runner seam, not a user path). Then drive Deny and Approve with DOM clicks.

- **Pending visible.** Run `... eval --port $PORT --js "window.__approval = window.cohort.requestApproval({botId:'chief',action:'send',summary:'Email Alex the recap',payload:'to: alex@example.com'}); true"`, then `... wait --port $PORT --js "document.querySelector('[role=dialog] h2')?.textContent === 'Ask first'"`. Snapshot shows `h2 "Ask first"`, copy that Deny is the safe default, Chief wants to send, the summary, a focused `Deny` button, and `Approve`.
- **Deny default.** With the prompt open, `... click --port $PORT --text "Deny"`, then `... wait --port $PORT --js "document.querySelector('[role=dialog]') === null"`. `await window.__approval` is `{ kind: 'denied' }`. `sqlite3 "$RUN_ROOT/home/approval.sqlite" "SELECT action, summary, payload, decision FROM approval_audit;"` is `send|Email Alex the recap|to: alex@example.com|denied`.
- **Dismiss is deny.** Request a `delete`. Press Escape (`... key --port $PORT --key Escape`) or click the dim backdrop. The dialog closes. Audit decision is `denied`.
- **Approve.** Request a `post`. `... click --port $PORT --text "Approve"`. `await window.__approval` is `{ kind: 'approved' }`. Audit row is `post|...|approved`.
- **Proof.** `... snapshot --port $PORT --path "$RUN_ROOT/evidence/approval/after.txt"` and `... screenshot --port $PORT --path "$RUN_ROOT/evidence/approval/after.png"`.

## Gotchas

- Owner chat Send, hatch, and Remove are owner actions. They do not open Ask first.
- `requestApproval` waits until Approve or Deny. Do not `await` it in the same eval that you need to return. Store the promise, then click.
- There is no email, browser, or commerce tool here. The prompt is the gate for those classes when computer-use lands.
- Escape denies every pending request (safe default).
