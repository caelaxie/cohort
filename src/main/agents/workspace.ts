/**
 * Shared room workspace (U5; KTD11, KTD15): one directory every agent's file
 * tools are rooted in, so agents can see and build on each other's output.
 *
 * The jail is enforced by the SDK's filesystem backend, not by convention:
 * every backend comes from `FilesystemBackend({ rootDir, virtualMode: true })`.
 * With `virtualMode: true` the backend treats incoming paths as virtual paths
 * under the root — `..` and `~` traversal is rejected, and absolute paths are
 * reinterpreted under the root instead of escaping it. Denials come back as
 * typed tool errors (`{ error }` results), so a jailed write fails the tool
 * call without crashing the turn.
 *
 * `permissions` rules (KTD15) layer declarative allow/deny on top of the jail
 * where needed; they are forwarded to `createDeepAgent` verbatim.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { FilesystemBackend, type FilesystemPermission } from "deepagents";

export interface RoomWorkspaceOptions {
  /**
   * Extra permission rules applied to every agent using this workspace.
   * Evaluated first-match-wins on top of the virtual-mode jail.
   */
  permissions?: FilesystemPermission[];
}

export interface RoomWorkspace {
  /** Absolute path of the shared workspace root. */
  readonly rootDir: string;
  /** Permission rules shared by all agents; pass to `createRoomAgent`. */
  readonly permissions: readonly FilesystemPermission[];
  /**
   * Create a filesystem backend for one agent. Each agent gets its own
   * backend instance, but every instance is rooted in (and jailed to) the
   * same shared directory.
   */
  createBackend(): FilesystemBackend;
}

/**
 * Create the shared room workspace rooted at `rootDir` (created on disk if
 * missing). The returned factory mints per-agent backends; all of them read
 * and write the same directory.
 */
export function createRoomWorkspace(
  rootDir: string,
  options: RoomWorkspaceOptions = {},
): RoomWorkspace {
  const absoluteRoot = resolve(rootDir);
  mkdirSync(absoluteRoot, { recursive: true });
  const permissions = options.permissions ?? [];
  return {
    rootDir: absoluteRoot,
    permissions,
    createBackend: () =>
      new FilesystemBackend({ rootDir: absoluteRoot, virtualMode: true }),
  };
}
