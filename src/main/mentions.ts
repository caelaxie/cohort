/**
 * @mention parsing.
 *
 * v1 rules (see the plan's Deferred Implementation Notes):
 * - Mentions are single-token `@Name` references (agent names are expected to
 *   be single tokens; multi-word names are out of scope for v1).
 * - The FIRST mention in a message is the routing target; later mentions are
 *   just text.
 * - Names resolve case-insensitively against the room roster; an unknown name
 *   resolves to `null` and the broker decides how to surface that.
 */

export interface MentionTarget {
  id: string;
  name: string;
}

/** Every `@Name` token in `text`, in order of appearance. */
export function parseMentions(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/@([A-Za-z][\w-]*)/g)) {
    names.push(match[1]);
  }
  return names;
}

/** The first `@Name` token in `text`, or `null` when there is none. */
export function firstMentionName(text: string): string | null {
  return parseMentions(text)[0] ?? null;
}

/** Resolve a mention name against the roster (case-insensitive). */
export function resolveMention(
  name: string,
  roster: readonly MentionTarget[],
): MentionTarget | null {
  const lower = name.toLowerCase();
  return roster.find((member) => member.name.toLowerCase() === lower) ?? null;
}

/**
 * v1 routing helper: resolve the FIRST mention in `text` against the roster.
 * Returns `null` when there is no mention or the name is unknown.
 */
export function resolveFirstMention(
  text: string,
  roster: readonly MentionTarget[],
): MentionTarget | null {
  const first = firstMentionName(text);
  return first ? resolveMention(first, roster) : null;
}
