# Cohort

Personal crew: local workspaces, one captain, boxed specialists.
v1 is for the owner. The first mission is unnamed — do not invent one.

See `ROADMAP.md` for sequence. Build the current unchecked v1 items only.

## Runtime

v1 uses **Deep Agents** (`deepagents`) on LangGraph. Embed it in the app. Do not use Prime Agent as the kernel.

## Product rules

- One captain can see every workspace: custom workspace prompts, files, chat history, and other workspace state. It may summarize any of that.
- You talk to the captain to run the current workspace.
- The captain creates a custom agent for a given workspace. That agent belongs to that workspace only.
- The captain can direct specialists and change files only in the current workspace.
- Every agent is highly autonomous inside its box.
- An agent can create tools for itself, on request or on its own. New tools stay in that workspace.
- The agent runtime must be embeddable and customizable in the Cohort app. Do not shell out to a separate agent product as the kernel.
- Each workspace is a sandboxed environment. A specialist cannot leave it.
- Specialists can only see files and chat in their own workspace.
- History stays with the workspace.
- “Summarize a list of files” is a demo, not the required first flow.

## Out of v1

Shared knowledge base, remote workspaces, other users, a general agent-to-agent protocol, pluggable runtimes, cloud sandboxes. Local workspace sandbox is assumed, not a later extra.

## Working here

- Use Deep Agents for captain and specialists. Pin each specialist to one workspace backend.
- Prefer the smallest change that preserves the rules above.
- Do not add users, cloud, or a knowledge base while v1 is open.
- Do not treat this repo’s `.agents/skills` as product code.
