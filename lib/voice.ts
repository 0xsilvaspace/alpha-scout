/** Shared helpers for Scout voice (Deepgram). Pure functions, so the
 *  harness can test them without a key or a network call. */

/** Turn a Scout reply into plain text fit to be spoken: markdown
 *  bold markers and source links are removed (the "Official source"
 *  link adds nothing when spoken), raw URLs are dropped, and the
 *  text is capped at 1,900 chars so the Deepgram REST call never
 *  hits its 2,000-char limit. */
export function stripForSpeech(text: string): string {
  let out = text;
  // Drop the source link lines entirely: "[Official source](url)".
  out = out.replace(/\[Official source\]\([^)\s]+\)/gi, "");
  // Any other markdown link keeps its text, drops the URL.
  out = out.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
  // Bold markers, raw URLs, then collapse whitespace.
  out = out.replace(/\*\*/g, "");
  out = out.replace(/https?:\/\/\S+/g, "");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length <= 1900) return out;
  const cut = out.slice(0, 1900);
  const lastSpace = cut.lastIndexOf(" ");
  return (
    (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[.;,\s]+$/, "") +
    "."
  );
}
