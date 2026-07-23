/**
 * Agent config — main-process side: resolves the shared catalog's tool
 * ids into concrete SDK wiring. Filesystem ids map onto the built-in
 * allowlist; `fetch_url` is a real in-repo web tool (the pinned
 * SDK ships no web tools). `execute`/shell never resolves — it is not in the
 * catalog.
 */
import { tool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import type { FsToolName } from "deepagents";
import { z } from "zod";

import { FS_TOOL_IDS } from "../shared/agent-config";

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_CHARS = 8_000;

/** Strip tags/scripts crudely; the workspace record stays the source of truth. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Real web fetch for the Researcher preset: http(s) only, bounded time and
 * output. Search engines are intentionally out of v1 — no provider key.
 */
export function createFetchUrlTool(): StructuredTool {
  return tool(
    async ({ url }: { url: string }): Promise<string> => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return `Error: "${url}" is not a valid URL.`;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `Error: only http(s) URLs can be fetched, got "${parsed.protocol}".`;
      }
      try {
        const response = await fetch(parsed, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow",
          headers: { "user-agent": "agent-room/0.1 (+local desktop app)" },
        });
        if (!response.ok) {
          return `Error: fetch failed with HTTP ${response.status}.`;
        }
        const body = await response.text();
        const text =
          (response.headers.get("content-type") ?? "").includes("html")
            ? htmlToText(body)
            : body.trim();
        if (text.length === 0) return "The page returned no readable text.";
        return text.length > FETCH_MAX_CHARS
          ? `${text.slice(0, FETCH_MAX_CHARS)}\n… (truncated)`
          : text;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "fetch_url",
      description:
        "Fetch a web page over http(s) and return its readable text, truncated to a few thousand characters.",
      schema: z.object({ url: z.string().describe("The http(s) URL to fetch") }),
    },
  );
}

/** Non-filesystem tool instances for a catalog selection. */
export function resolveExtraTools(toolIds: readonly string[]): StructuredTool[] {
  return toolIds.includes("fetch_url") ? [createFetchUrlTool()] : [];
}

const FS_ID_SET = new Set<string>(FS_TOOL_IDS);

/**
 * Filesystem allowlist for a catalog selection (undefined when the agent has
 * no filesystem tools — the SDK's capability-filtered default then applies,
 * which the jail still bounds). `read_file` always leads: the SDK requires
 * it in every explicit allowlist.
 */
export function fsToolAllowlist(toolIds: readonly string[]): FsToolName[] | undefined {
  const fs = toolIds.filter((id): id is FsToolName => FS_ID_SET.has(id));
  if (fs.length === 0) return undefined;
  return ["read_file", ...fs.filter((id) => id !== "read_file")];
}
