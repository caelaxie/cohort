/**
 * Minimal markdown renderer for chat bubbles.
 * - Raw HTML is never interpreted.
 * - Links restricted to http/https.
 * - Tolerates unterminated fenced code blocks (streaming).
 */
import { Fragment, type ReactNode } from "react";

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const CODE_RE = /`([^`]+)`/g;

function safeHref(href: string): string | null {
  try {
    const url = new URL(href, "https://example.invalid");
    if (url.protocol === "http:" || url.protocol === "https:") {
      return href;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  // Order: code → links → bold → italic. Work on a token stream.
  type Part = { type: "text" | "code" | "link" | "bold" | "italic"; value: string; href?: string };
  let parts: Part[] = [{ type: "text", value: text }];

  function split(
    source: Part[],
    re: RegExp,
    map: (match: RegExpExecArray) => Part,
  ): Part[] {
    const out: Part[] = [];
    for (const part of source) {
      if (part.type !== "text") {
        out.push(part);
        continue;
      }
      const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
      const local = new RegExp(re.source, flags);
      let last = 0;
      let m: RegExpExecArray | null;
      const chunk = part.value;
      while ((m = local.exec(chunk)) !== null) {
        if (m.index > last) {
          out.push({ type: "text", value: chunk.slice(last, m.index) });
        }
        out.push(map(m));
        last = m.index + m[0].length;
      }
      if (last < chunk.length) {
        out.push({ type: "text", value: chunk.slice(last) });
      }
    }
    return out;
  }

  parts = split(parts, CODE_RE, (m) => ({ type: "code", value: m[1] }));
  parts = split(parts, LINK_RE, (m) => ({ type: "link", value: m[1], href: m[2] }));
  parts = split(parts, BOLD_RE, (m) => ({ type: "bold", value: m[1] }));
  parts = split(parts, ITALIC_RE, (m) => ({ type: "italic", value: m[1] }));

  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (part.type) {
      case "code":
        return (
          <code key={key} className="md-code">
            {part.value}
          </code>
        );
      case "link": {
        const href = part.href ? safeHref(part.href) : null;
        if (!href) return <span key={key}>{part.value}</span>;
        return (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {part.value}
          </a>
        );
      }
      case "bold":
        return <strong key={key}>{part.value}</strong>;
      case "italic":
        return <em key={key}>{part.value}</em>;
      default:
        return <Fragment key={key}>{part.value}</Fragment>;
    }
  });
}

interface Block {
  type: "p" | "code";
  lang?: string;
  lines: string[];
}

function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      // Tolerate unterminated fence (streaming): consume rest.
      if (i < lines.length && lines[i].startsWith("```")) i += 1;
      blocks.push({ type: "code", lang, lines: body });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !lines[i].match(/^```/)) {
      para.push(lines[i]);
      i += 1;
      if (para[para.length - 1] === "" && para.length > 1) break;
    }
    const text = para.join("\n").replace(/\n+$/, "");
    if (text.length > 0) blocks.push({ type: "p", lines: [text] });
  }
  return blocks;
}

export function renderMarkdown(source: string): ReactNode {
  const blocks = parseBlocks(source);
  return blocks.map((block, bi) => {
    if (block.type === "code") {
      return (
        <pre key={`c-${bi}`} className="md-pre" data-lang={block.lang}>
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
    }
    return (
      <p key={`p-${bi}`} className="md-p">
        {inlineMarkdown(block.lines.join("\n"), `p${bi}`)}
      </p>
    );
  });
}
