# Cohort

Personal crew: local workspaces, one captain per workspace, boxed specialists.
v1 is for the owner. The first mission is unnamed — do not invent one.

See `ROADMAP.md` for sequence. Build the current unchecked v1 items only.

## Runtime

v1 uses **Prime Agent**, embedded in the app. One Prime session per workspace. Do not use Deep Agents. Do not shell out to the Prime CLI as the kernel.

## Product rules

- Each workspace has one captain. That captain belongs to that workspace only.
- The captain is workspace-isolated: it can see only that workspace’s prompts, files, chat, and other state.
- You talk to the current workspace’s captain to run it.
- The captain can create specialists for its workspace. Those agents belong to that workspace only.
- The captain can direct specialists and change files only in its workspace.
- Every agent is highly autonomous inside its box.
- An agent can create tools for itself, on request or on its own. New tools stay in that workspace.
- The agent runtime must be embeddable and customizable in the Cohort app. Do not shell out to a separate agent product as the kernel.
- Each workspace is a sandboxed environment. Captain and specialists cannot leave it.
- Captain and specialists can only see files and chat in their own workspace.
- History stays with the workspace.
- “Summarize a list of files” is a demo, not the required first flow.

## Out of v1

A captain that can see or summarize other workspaces. Shared knowledge base, remote workspaces, other users, a general agent-to-agent protocol, pluggable runtimes, cloud sandboxes. Local workspace sandbox is assumed, not a later extra.

## Working here

- Use Prime Agent for captain and specialists. Pin each captain and each specialist to one workspace box. No host-wide Prime daemon across workspaces.
- Prefer the smallest change that preserves the rules above.
- Do not add users, cloud, or a knowledge base while v1 is open.
- Do not treat this repo’s `.agents/skills` as product code.
