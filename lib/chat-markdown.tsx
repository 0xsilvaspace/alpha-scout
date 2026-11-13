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
  return blocks.map((block, bi) => {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    // Bulleted list block: every line starts with "- ".
    if (lines.every((l) => l.startsWith("- "))) {
      return (
        <ul key={bi} className="my-1 list-disc space-y-1 pl-5">
          {lines.map((l, i) => (
            <li key={i} className="leading-relaxed">
              {renderInline(l.slice(2), `b${bi}-${i}`)}
            </li>
          ))}
        </ul>
      );
    }
    // Any other block: lines joined with breaks, so a numbered item
    // (title, what it offers, closing date, source link) reads as one
    // entry with the blank line between items doing the separating.
    return (
      <p key={bi} className="my-1 leading-relaxed">
        {lines.map((l, i) => (
          <span key={i}>
            {i > 0 ? <br /> : null}
            {renderInline(l, `b${bi}-${i}`)}
          </span>
        ))}
      </p>
    );
  });
}
