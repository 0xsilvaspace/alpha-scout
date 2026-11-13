import React, { type ReactNode } from "react";

/**
 * Minimal safe markdown renderer for Scout replies: **bold**,
 * [text](url) links, paragraphs, and bulleted lists. The chat used to
 * print replies as plain text, so **bold** markers and raw markdown
 * links showed literally in the bubble. Anything this parser does not
 * recognise renders as plain text. React escapes text nodes, and links
 * are only built for http(s) URLs, so no raw HTML can reach the page.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(
    /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g,
  );
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link && /^https?:\/\//.test(link[2])) {
      return (
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-green-800 underline"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

export function renderChatMarkdown(text: string): ReactNode[] {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  const out: ReactNode[] = [];
  let key = 0;
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    // Bulleted list block: every line starts with "- ".
    if (lines.every((l) => l.startsWith("- "))) {
      out.push(
        <ul key={key++} className="my-1 list-disc space-y-1 pl-5">
          {lines.map((l, i) => (
            <li key={i} className="leading-relaxed">
              {renderInline(l.slice(2), `u${key}-${i}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    // Split a block into groups: a bold-only title line (numbered or
    // not) always starts a new group, so a model reply that runs its
    // items consecutively without blank lines still renders as
    // separate entries instead of one long paragraph.
    const groups: string[][] = [];
    let current: string[] = [];
    for (const line of lines) {
      const isTitle = /^\d+\.\s+\*\*[^*]+\*\*$/.test(line) || /^\*\*[^*]+\*\*$/.test(line);
      if (current.length > 0 && isTitle) {
        groups.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) groups.push(current);
    // Number the item groups when the model wrote none, so the list
    // still reads as a numbered list. The opening line is not an item
    // and is never numbered; groups that already carry a number are
    // left alone.
    const isItem = (g: string[]) =>
      /^\d+\.\s+\*\*[^*]+\*\*$/.test(g[0]) || /^\*\*[^*]+\*\*$/.test(g[0]);
    const itemGroups = groups.filter(isItem);
    const needsNumbers =
      itemGroups.length > 1 &&
      itemGroups.every((g) => !/^\d+\.\s/.test(g[0]));
    let itemIndex = 0;
    for (const g of groups) {
      let first = g[0];
      if (isItem(g) && needsNumbers) {
        itemIndex += 1;
        first = `${itemIndex}. ${first}`;
      }
      out.push(
        <p key={key++} className="my-2 leading-relaxed">
          {[first, ...g.slice(1)].map((l, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              {renderInline(l, `g${key}-${i}`)}
            </span>
          ))}
        </p>,
      );
    }
  }
  return out;
}
