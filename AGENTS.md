# Cohort

Open-source Grok Bot: named AI teammates on this Mac.
The lead bot is **Hatch**. v1 is for the owner. Do not invent a first vertical — the crew is the product.

See `ROADMAP.md` for sequence. This branch redefines the product. Do not implement the reshape here unless asked.
Behavior IDs live in `docs/plans/2026-09-09-1325-feat-hatch-grok-bot-alternative-plan.md`.

## Runtime

v1 uses **Prime Agent**, embedded in the app. Do not use Deep Agents. Do not shell out to the Prime CLI as the kernel.
A computer-use driver is the hands, not the kernel.

## Product rules

- Cohort is the product. Hatch is the lead bot, not the product name.
- Home is a roster of named bots, not workspaces. Hatch is on that roster.
- You talk to Hatch and to the bots it hatches as teammates.
- Hatch can hatch another named bot.
- Hatch can coordinate other bots.
- The owner can sit in a shared room with Hatch and several bots at once.
- The computer is this Mac while Cohort is open. Work stops when Cohort closes.
- Hands in v1 are the browser the owner is already logged into. Bots share that one login.
- Before send, post, buy, or delete in the browser, the bot waits for the owner's yes. Only the owner can approve.
- The owner brings their own model subscriptions. Cohort does not impose a weekly cap.
- The agent runtime must be embeddable in the Cohort app. Do not shell out to a separate agent product as the kernel.

## Out of v1

Native Mac apps as hands. A hosted remote computer. Overnight and lid-closed work. Company-scale use and other users. iOS. Learned routines and 24/7 schedules. A sealed workspace sandbox as the computer. Workspaces as the home screen.

The workspace roster, add-files loop, and Boxlite box in the current app are leftover, not the product.

## Working here

- Prefer the smallest change that preserves the rules above.
- Do not add users, cloud, or a knowledge base while v1 is open.
- Do not treat this repo’s `.agents/skills` as product code.
- Do not implement this reshape on this branch unless the owner asks. Redefine docs and the Product Contract only.
