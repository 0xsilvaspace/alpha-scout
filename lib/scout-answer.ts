/**
 * ALPHA SCOUT: deterministic chatbot answers and deal ranking.
 *
 * Pure functions over the prepared deals: keyword scoring, ranking,
 * snapshots, and the deterministic answer layer that answers from the
 * listings themselves before any model call is attempted. No Next.js,
 * auth or network access in here, so it can be unit-tested directly.
 */

import { daysLeft } from "./deals";
import type { DisplayTrack, ResolvedDeal } from "./classify";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "what", "which", "that", "this", "are",
  "there", "here", "have", "has", "from", "about", "when", "where",
  "list", "show", "give", "tell", "please", "open", "free", "any",
  "all", "can", "you", "your", "our", "out", "into", "more", "some",
  "does", "like", "need", "want", "get", "also", "still", "available",
  "site", "listed", "opportunity", "opportunities", "page",
]);

const DEADLINE_WORDS = /\b(deadline|deadlines|closing|closes|close|expir|expires|expiry|due|soon|running out|last date)\b/i;

// Track words a question may use, mapped to the deal track they mean.
// "study" is deliberately NOT a scholarship word: it appears in
// "course of study" and "field of study", and a jobs question about a
// course of study must not be misread as a scholarship question.
const TRACK_WORDS: Record<string, string[]> = {
  scholarships: ["scholarship", "scholarships", "masters", "phd"],
  grants: ["grant", "grants", "funding", "fund"],
  hackathons: ["hackathon", "hackathons", "hack", "buildathon", "hackweek"],
  competitions: ["competition", "competitions", "contest", "contests", "challenge", "challenges", "cup", "games", "olympiad"],
  jobs: ["job", "jobs", "remote", "work", "hire", "hiring"],
  "ai-tools": ["ai", "tool", "tools", "api", "model", "llm"],
  crypto: ["crypto", "token", "nft", "blockchain", "web3", "coin"],
  banking: ["bank", "banking", "card", "account", "finance"],
  cloud: ["cloud", "gpu", "hosting", "server", "compute"],
  software: ["software", "app", "apps", "saas", "design", "code", "coding"],
};

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function wordForms(w: string): string[] {
  // Match singular and plural forms of a question word.
  if (w.endsWith("s")) return [w, w.slice(0, -1)];
  return [w, `${w}s`];
}

function scoreDeal(d: ResolvedDeal, tokens: string[]): number {
  const haystack = `${d.title} ${d.track} ${d.eligibility} ${d.requirements}`.toLowerCase();
  // Whole-word matching: substring matching let "many" match "Germany"
  // and inflated scores for unrelated deals.
  const hayWords = new Set(haystack.match(/[a-z0-9]+/g) ?? []);
  const titleWords = new Set(d.title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  let score = 0;
  for (const t of tokens) {
    const forms = wordVariants(t);
    if (forms.some((f) => hayWords.has(f))) score += 1;
    if (forms.some((f) => titleWords.has(f))) score += 1;
  }
  for (const [track, words] of Object.entries(TRACK_WORDS)) {
    if (d.track === track && words.some((w) => tokens.includes(w))) score += 2;
  }
  return score;
}

function isClosingSoon(d: ResolvedDeal): boolean {
  const left = daysLeft(d);
  return left !== null && left >= 0 && left <= 14;
}

/* ------------------------------------------------------------------ */
/* Deterministic answers: the data answers first                     */
/* ------------------------------------------------------------------ */

// Free-tier model calls keep failing in production (Gemini timeouts,
// OpenRouter upstream 429s), so any question the listings themselves
// can answer is answered here, with no model call at all. The model
// race is only for questions that need judgment or reasoning.

/** Same rule the site uses to display deal text (DealCard). */
function clean(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ", ").replace(/^, /, "");
}

/** Shorten text to at most max chars, cutting at a word boundary and
 *  ending with a period. Never slices a word and never leaves "...". */
function shorten(text: string, max: number): string {
  const t = clean(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  let kept = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(
    /[.;,\s]+$/,
    "",
  );
  // Never leave an unclosed parenthesis behind.
  const open = (kept.match(/\(/g) ?? []).length;
  const close = (kept.match(/\)/g) ?? []).length;
  if (open > close) {
    kept = kept.slice(0, kept.lastIndexOf("(")).replace(/[.;,\s]+$/, "");
  }
  return `${kept}.`;
}

/** Split field text into clauses on semicolons and sentence ends. */
function clauses(text: string): string[] {
  return clean(text)
    .split(/;\s*|\.\s+/)
    .map((c) => c.trim().replace(/[.;\s]+$/, ""))
    .filter((c) => c.length > 0);
}

/** First clause of a field, e.g. the audience before the extra detail. */
function firstClause(text: string): string {
  return clauses(text)[0] ?? "";
}

/** Split a comma/plus-separated field into its items. */
function proseItems(text: string): string[] {
  return clean(text)
    .split(/\s*\+\s*|,\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Join list fragments ("a, b, c") into prose ("a, b and c"). */
function proseList(text: string): string {
  const items = proseItems(text);
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Normalise one requirement fragment so it reads after "applicants
 *  need": bare verbs become "to ...", bare nouns get an article. */
function normalizeFragment(item: string): string {
  const t = lowerFirst(item.trim());
  if (
    /^(apply|register|submit|complete|upload|pick|hold|have|provide|create|choose|send|check|confirm|watch|download|generate)\b/.test(
      t,
    )
  ) {
    return `to ${t}`;
  }
  if (/^(first|second|third)\b/.test(t)) return `a ${t}`;
  if (/^(proof|access|experience|funding|support)\b/.test(t)) return t;
  const article = /^[aeiou]/.test(t) ? "an" : "a";
  return `${article} ${t}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

/** "Applications close on 30 November 2026, in 18 days." */
function deadlineSentence(d: ResolvedDeal): string {
  if (!d.expiresOn) return "There is no closing date listed.";
  const left = daysLeft(d);
  const date = formatDate(d.expiresOn);
  if (left === null) return `Applications close on ${date}.`;
  if (left < 0) return `Applications closed on ${date}.`;
  if (left === 0) return `Applications close today, ${date}.`;
  if (left === 1) return `Applications close tomorrow, ${date}.`;
  return `Applications close on ${date}, in ${left} days.`;
}

/** "Closes 30 November 2026 (in 18 days)" for list lines. */
function closesClause(d: ResolvedDeal): string {
  if (!d.expiresOn) return "No closing date listed";
  const left = daysLeft(d);
  const date = formatDate(d.expiresOn);
  if (left === null) return `Closes ${date}`;
  if (left < 0) return `Closed ${date}`;
  if (left === 0) return `Closes today, ${date}`;
  if (left === 1) return `Closes tomorrow, ${date}`;
  return `Closes ${date} (in ${left} days)`;
}

/** What the listing is, in one word, from its title first. */
function dealNoun(d: ResolvedDeal): string {
  const t = d.title.toLowerCase();
  if (/\bscholarship\b/.test(t)) return "scholarship";
  if (/\bfellowship\b/.test(t)) return "fellowship";
  if (/\bhackathon\b|\bhack week\b/.test(t)) return "hackathon";
  if (/\bcompetition\b|\bcontest\b|\bchallenge\b|\bolympiad\b/.test(t)) return "competition";
  if (/\bgrant\b/.test(t)) return "grant";
  if (/\bjob\b|\bexpert\b|\bresearcher\b|\binternship\b/.test(t)) return "remote job";
  if (/\btool\b|\bapi\b/.test(t)) return "free tool";
  if (/\baccount\b|\bcard\b/.test(t)) return "banking offer";
  const labels: Record<string, string> = {
    scholarships: "scholarship",
    grants: "grant",
    hackathons: "hackathon",
    competitions: "competition",
    jobs: "remote job",
    "ai-tools": "free AI tool",
    cloud: "cloud offer",
    software: "software offer",
    banking: "banking offer",
    crypto: "crypto opportunity",
  };
  return labels[d.track] ?? "opportunity";
}

/** Short value clause for list lines: the headline figure only.
 *  Splits on the first colon or semicolon outside parentheses, so
 *  "$250,000 ... (grand prize $55,000; $10,000 x 13 first places)"
 *  is not sliced mid-parenthesis by the semicolon inside it. */
function valueClause(d: ResolvedDeal): string {
  const value = clean(d.estimatedValue).trim();
  if (/^no cash (?:prize )?stated\b/i.test(value)) return "There is no cash prize";
  let depth = 0;
  let head = value;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === ":" || ch === ";") && depth === 0) {
      head = value.slice(0, i);
      break;
    }
  }
  let out = head.trim().replace(/\s*\+\s*/g, " plus ");
  const open = (out.match(/\(/g) ?? []).length;
  const close = (out.match(/\)/g) ?? []).length;
  if (open > close) out = out.slice(0, out.lastIndexOf("(")).trim();
  return out;
}

/** The value as a natural sentence. "No cash stated" is rephrased,
 *  never printed raw as an opening. */
function valueSentence(d: ResolvedDeal): string {
  const value = clean(d.estimatedValue).trim();
  // clean() turns the em dash into a comma, so "No cash stated — ..."
  // arrives here as "No cash stated, ...".
  const noCash = value.match(/^no cash (?:prize )?stated\s*[,—–-]\s*(.+)$/i);
  const noun = dealNoun(d);
  if (noCash) {
    const rest = proseList(noCash[1].trim());
    return `There is no cash prize. The ${noun} offers ${lowerFirst(rest)}.`;
  }
  const withPlus = value.replace(/\s*\+\s*/g, " plus ").replace(/[.;\s]+$/, "");
  return `It offers ${lowerFirst(withPlus)}.`;
}

/** Who the listing is for: the first clause of the eligibility text,
 *  with "Open to" and "Listing states" lead-ins removed. */
function audienceClause(d: ResolvedDeal): string {
  const a = firstClause(d.eligibility);
  return a
    .replace(/^listing states\s+/i, "")
    .replace(/^open to\s+/i, "")
    .trim();
}

/** Requirements that add something new: clauses not already covered
 *  by the eligibility text or the action steps. Returns "" when the
 *  requirements only repeat them. */
function requirementsProse(d: ResolvedDeal): string {
  const reqText = clean(d.requirements).trim();
  if (!reqText) return "";
  const contentWords = (s: string): Set<string> =>
    new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const eligWords = contentWords(d.eligibility);
  const stepWords = contentWords(d.actionSteps);
  const kept = clauses(reqText).filter((c) => {
    const words = contentWords(c);
    if (words.size === 0) return false;
    const inElig =
      [...words].filter((w) => eligWords.has(w)).length / words.size;
    const inSteps =
      [...words].filter((w) => stepWords.has(w)).length / words.size;
    return inElig < 0.6 && inSteps < 0.6;
  });
  if (kept.length === 0) return "";
  const items = proseItems(kept.join(", ")).map(normalizeFragment);
  const joined =
    items.length <= 1
      ? items[0] ?? ""
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return shorten(joined, 260).replace(/[.;\s]+$/, "");
}

/** Eligibility and requirements merged into one clean sentence, never
 *  printed back to back as raw fields. */
function whoSentence(d: ResolvedDeal): string {
  const a = audienceClause(d);
  const req = requirementsProse(d);
  if (!a && !req) return "";
  if (!a) return `Applicants need ${req}.`;
  if (/^open in\b/i.test(a)) {
    return req
      ? `It is ${a}, and applicants need ${req}.`
      : `It is ${a}.`;
  }
  return req
    ? `It is for ${a}, and applicants need ${req}.`
    : `It is for ${a}.`;
}

/** Numbered action steps ("1. ... 2. ...") as flowing prose. */
function stepsProse(d: ResolvedDeal): string {
  const raw = clean(d.actionSteps).trim();
  if (!raw) return "";
  const parts = raw
    .split(/\d+\.\s*/)
    .map((s) => s.trim().replace(/[.;\s]+$/, ""))
    .filter((s) => s.length > 0);
  if (parts.length === 0) return "";
  const lowered = parts.map(lowerFirst);
  if (lowered.length === 1) return `To apply, ${lowered[0]}.`;
  // The last step often already contains ", then ...": turn it into
  // ", followed by ..." so the sentence flows.
  const last = lowered[lowered.length - 1];
  const split = last.split(/,\s*then\s+/i);
  if (split.length > 1) {
    const steps = [...lowered.slice(0, -1), split[0]];
    return `To apply, ${steps.join(", ")}, followed by ${split[1]}.`;
  }
  return `To apply, ${lowered.slice(0, -1).join(", ")}, then ${lowered[lowered.length - 1]}.`;
}

/** One listing as a clean list item: title on its own line, one short
 *  line saying what it offers, the closing date on its own line at the
 *  bottom of the item, then the official source link on its own line.
 *  The deadline is never packed into the description sentence and a
 *  raw URL is never printed. Pass an index for numbered lists. */
function dealItem(d: ResolvedDeal, index?: number): string {
  const title =
    index === undefined
      ? `**${clean(d.title)}**`
      : `${index}. **${clean(d.title)}**`;
  const value = shorten(valueClause(d), 90).replace(/[.;\s]+$/, "");
  return [title, `${value}.`, `${closesClause(d)}.`, `[Official source](${d.sourceUrl})`].join("\n");
}

/** Short title for comparison sentences: drop parentheticals and any
 *  subtitle after a dash, when the first part stands on its own. */
function shortTitle(d: ResolvedDeal): string {
  const t = clean(d.title)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const sep of [/\s+[—–-]\s+/, /,\s+/]) {
    const parts = t.split(sep);
    if (parts.length > 1 && parts[0].trim().split(/\s+/).length >= 3) {
      return parts[0].trim();
    }
  }
  return t;
}

const REGIONS: [RegExp, string][] = [
  [/germany/i, "Germany"],
  [/africa/i, "Africa"],
  [/\buk\b/i, "the UK"],
  [/europe/i, "Europe"],
  [/usa|united states|america/i, "the USA"],
  [/nigeria/i, "Nigeria"],
  [/rwanda/i, "Rwanda"],
  [/kenya/i, "Kenya"],
  [/france/i, "France"],
  [/hungary/i, "Hungary"],
  [/canada/i, "Canada"],
  [/china/i, "China"],
  [/india/i, "India"],
  [/australia/i, "Australia"],
  [/worldwide|global/i, "anywhere in the world"],
];

/** The destination a listing is for, from its title and eligibility. */
function dealRegion(d: ResolvedDeal): string | null {
  const text = `${d.title} ${d.eligibility}`;
  for (const [re, name] of REGIONS) if (re.test(text)) return name;
  return null;
}

/** The closing sentence of a comparison: the real main difference,
 *  destination first, then funding, then deadline. */
function closingDifference(named: ScoredDeal[]): string {
  const withRegion = named
    .map((s) => ({ s, region: dealRegion(s.d) }))
    .filter((x): x is { s: ScoredDeal; region: string } => x.region !== null);
  const first = withRegion[0];
  const other = withRegion.find((x) => x.region !== first?.region);
  if (first && other) {
    const inA =
      first.region === "anywhere in the world"
        ? "open anywhere in the world"
        : `in ${first.region}`;
    const inB =
      other.region === "anywhere in the world"
        ? "open anywhere in the world"
        : `in ${other.region}`;
    return `The main difference is destination: ${shortTitle(first.s.d)} is ${inA}, while ${shortTitle(other.s.d)} is ${inB}.`;
  }
  const valued = named
    .filter((s) => s.d.valueUsd !== null)
    .sort((a, b) => (b.d.valueUsd ?? 0) - (a.d.valueUsd ?? 0));
  if (
    valued.length >= 2 &&
    valued[0].d.valueUsd !== valued[valued.length - 1].d.valueUsd
  ) {
    return `${shortTitle(valued[0].d)} lists the larger award at ${valueClause(valued[0].d)}.`;
  }
  const dated = named
    .filter((s) => s.d.expiresOn)
    .sort((a, b) => bySoonest(a.d, b.d));
  if (
    dated.length >= 2 &&
    dated[0].d.expiresOn !== dated[dated.length - 1].d.expiresOn
  ) {
    return `${shortTitle(dated[0].d)} closes first, on ${formatDate(dated[0].d.expiresOn as string)}, while ${shortTitle(dated[dated.length - 1].d)} runs until ${formatDate(dated[dated.length - 1].d.expiresOn as string)}.`;
  }
  return "They differ mainly in eligibility and focus, so check the official source for the one that fits you.";
}

function bySoonest(a: ResolvedDeal, b: ResolvedDeal): number {
  return (daysLeft(a) ?? 99) - (daysLeft(b) ?? 99);
}

/** Expired listings are not answered about. */
function activeDeals(deals: ResolvedDeal[]): ResolvedDeal[] {
  return deals.filter((d) => {
    const left = daysLeft(d);
    return left === null || left >= 0;
  });
}

function titleHits(d: ResolvedDeal, tokens: string[]): number {
  const titleWords = new Set(d.title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  let n = 0;
  for (const t of tokens) {
    const forms = wordVariants(t);
    // Generic category words ("scholarship", "competition") do not make
    // a deal a named match: "Mastercard Edinburgh scholarship" must not
    // match a Mastercard deal just because its title says "Scholarship".
    if (forms.some((f) => GENERIC_SUBJECT.has(f))) continue;
    if (forms.some((f) => titleWords.has(f))) n += 1;
  }
  return n;
}

interface ScoredDeal {
  d: ResolvedDeal;
  score: number;
  hits: number;
}

function scoreAll(deals: ResolvedDeal[], tokens: string[]): ScoredDeal[] {
  return deals
    .map((d) => ({ d, score: scoreDeal(d, tokens), hits: titleHits(d, tokens) }))
    .sort((a, b) => b.score - a.score || bySoonest(a.d, b.d));
}

/** A deal is a confident match when its title carries the question's
 *  words, or its score is high and clearly ahead of the runner-up. */
function isStrong(top: ScoredDeal, second: ScoredDeal | undefined): boolean {
  if (top.hits >= 2) return true;
  return top.score >= 5 && (!second || top.score - second.score >= 2);
}

/** Lowercase the first letter, for flowing text after a lead-in. */
function lowerFirst(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const first = t.search(/[A-Za-z]/);
  if (first < 0) return t;
  return t.slice(0, first) + t[first].toLowerCase() + t.slice(first + 1);
}

/** Full brief of one deal, written as natural prose: an opening that
 *  says what it is and who it is for, the value in plain words, the
 *  deadline, who it is for and what it takes in one merged sentence,
 *  the steps as flowing prose, and the official source on its own
 *  line. Never opens with a raw field value and never prints
 *  eligibility and requirements back to back. */
function singleDealReply(d: ResolvedDeal): string {
  const title = clean(d.title);
  const body = [
    `The **${title}** is a free ${dealNoun(d)}.`,
    valueSentence(d),
    deadlineSentence(d),
  ];
  const who = whoSentence(d);
  if (who) body.push(who);
  const steps = stepsProse(d);
  if (steps) body.push(steps);
  return `${body.join(" ")}\n\n[Official source](${d.sourceUrl})`;
}

type DealField = "deadline" | "value" | "requirements" | "steps";

function detectField(question: string): DealField | null {
  const q = question.toLowerCase();
  if (/\b(deadline|deadlines|when (does|do|is|will)|close|closes|closing|expires|expiry|due|last date)\b/.test(q)) return "deadline";
  if (/\b(how much|worth|prize|prizes|pay|pays|salary|amount|value|reward|win|winning)\b/.test(q)) return "value";
  if (/\b(requirement|requirements|eligible|eligibility|qualify|qualification|who can|who is eligible|need|needs)\b/.test(q)) return "requirements";
  if (/\b(how (do i|to)|apply|join|register|sign ?up|steps|get started|participate|take part)\b/.test(q)) return "steps";
  return null;
}

function fieldReply(d: ResolvedDeal, field: DealField): string {
  const title = `**${clean(d.title)}**`;
  switch (field) {
    case "deadline":
      return `${title}\n\n${deadlineSentence(d)} ${valueSentence(d)}\n\n[Official source](${d.sourceUrl})`;
    case "value":
      return `${title}\n\n${valueSentence(d)} ${deadlineSentence(d)}\n\n[Official source](${d.sourceUrl})`;
    case "requirements": {
      const who = whoSentence(d);
      return `${title}\n\n${who ? `${who} ` : ""}${deadlineSentence(d)}\n\n[Official source](${d.sourceUrl})`;
    }
    case "steps": {
      const steps = stepsProse(d);
      return `${title}\n\n${steps ? `${steps} ` : ""}${deadlineSentence(d)}\n\n[Official source](${d.sourceUrl})`;
    }
  }
}

const COMPARISON_RE = /\bcompare\b|\bvs\.?\b|versus|which is better|difference between/i;

/** Side-by-side facts for each named deal, in tidy blocks with
 *  matching facts per deal, plus one closing sentence on the main
 *  difference. No winner is picked. */
function comparisonReply(named: ScoredDeal[]): string {
  const lines = ["Here is how they compare:", ""];
  for (const s of named) {
    const d = s.d;
    lines.push(`**${clean(d.title)}**`);
    lines.push(valueSentence(d));
    lines.push(deadlineSentence(d));
    const a = audienceClause(d);
    if (a) {
      lines.push(/^open in\b/i.test(a) ? `It is ${a}.` : `It is for ${a}.`);
    }
    lines.push(`[Official source](${d.sourceUrl})`, "");
  }
  lines.push(closingDifference(named));
  return lines.join("\n").trimEnd();
}

/** Questions that need judgment or a recommendation go to the model,
 *  never to the deterministic layer. Fit phrasing counts too: "jobs
 *  well aligned with my course of study" is a judgment about which
 *  jobs fit the field, not a request for the closest keyword match. */
const JUDGMENT_RE = /\b(should i|recommend|suggest|best for me|right for me|good for me|which (one )?should|what should i|fits? (a|an|me|my)|suited? (for|to)|help me (choose|pick|decide)|aligned? (with|to)|match(es)? (my|me)|relevant to (my|me)|for my (course|degree|field|background|study))\b/i;

const ABOUT_RE = /^\s*(tell me about|what is|what's|whats|details of|tell me more about)\b/i;

/** Generic category words: a subject made only of these is not a named
 *  opportunity, so "tell me about scholarships" is a track question,
 *  not an absent listing. */
const GENERIC_SUBJECT = new Set([
  "scholarship", "scholarships", "grant", "grants", "hackathon",
  "hackathons", "competition", "competitions", "job", "jobs", "tool",
  "tools", "program", "programme", "programs", "programmes",
  "opportunity", "opportunities", "deal", "deals", "list", "site",
  "offer", "offers", "crypto", "software", "banking", "cloud", "ai",
]);

function extractSubject(question: string): string {
  let s = question.replace(/^\s*(tell me about|what is|what's|whats|details of|tell me more about)\s*/i, "");
  s = s.replace(/\s+(on this site|on the site|here)\s*$/i, "");
  s = s.replace(/^\s*(this|that|the)\s+/i, "");
  return s.trim();
}

function absentReply(
  subject: string,
  closest: ScoredDeal[],
  track?: DisplayTrack | null,
): string {
  const lines = [`I could not find ${subject} on the site.`];
  // The closest matches are drawn from the kind the user asked about
  // only: a jobs question must never be answered with scholarships.
  const inTrack = track
    ? closest.filter((s) => s.d.track === track)
    : closest;
  if (inTrack.length > 0) {
    lines.push("", "The closest matches are:", "");
    for (const s of inTrack) lines.push(dealItem(s.d), "");
  }
  lines.push("Check the site for the full list of opportunities.");
  return lines.join("\n").trimEnd();
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
];

interface WindowFilter {
  label: string;
  predicate: (d: ResolvedDeal) => boolean;
}

/** A specific deadline window: a named month, this week, this month,
 *  next week or next month. */
function detectWindow(question: string): WindowFilter | null {
  const q = question.toLowerCase();
  const yearMatch = q.match(/\b(20\d{2})\b/);
  const now = new Date();
  const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
  for (let i = 0; i < MONTHS.length; i++) {
    if (!new RegExp(`\\b${MONTHS[i]}\\b`).test(q)) continue;
    // "may" is also a verb; only treat it as a month with a deadline cue.
    if (MONTHS[i] === "may" && !DEADLINE_WORDS.test(question)) continue;
    if (!DEADLINE_WORDS.test(question) && !/\b(which|list|show|find|any|what)\b/i.test(question)) return null;
    const mm = String(i + 1).padStart(2, "0");
    const prefix = `${year}-${mm}`;
    const name = `${MONTHS[i][0].toUpperCase()}${MONTHS[i].slice(1)}`;
    return {
      label: `in ${name} ${year}`,
      predicate: (d) => d.expiresOn !== null && d.expiresOn.startsWith(prefix),
    };
  }
  if (/\bthis week\b/.test(q)) {
    return {
      label: "this week",
      predicate: (d) => {
        const l = daysLeft(d);
        return l !== null && l >= 0 && l <= 7;
      },
    };
  }
  if (/\bnext week\b/.test(q)) {
    return {
      label: "next week",
      predicate: (d) => {
        const l = daysLeft(d);
        return l !== null && l > 7 && l <= 14;
      },
    };
  }
  if (/\bthis month\b/.test(q)) {
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      label: "this month",
      predicate: (d) => d.expiresOn !== null && d.expiresOn.startsWith(prefix),
    };
  }
  if (/\bnext month\b/.test(q)) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prefix = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    return {
      label: "next month",
      predicate: (d) => d.expiresOn !== null && d.expiresOn.startsWith(prefix),
    };
  }
  return null;
}

type CostFilter = "truly-free" | "free-tier" | "free-trial-card";

function detectCost(question: string): { cost: CostFilter; label: string } | null {
  const q = question.toLowerCase();
  if (/\bno card\b|without (a )?card|card-free|no card needed|no card required/.test(q)) {
    return { cost: "truly-free", label: "truly free, no card needed" };
  }
  if (/\btruly free\b|completely free\b|totally free\b/.test(q)) {
    return { cost: "truly-free", label: "truly free" };
  }
  if (/\bfree trial\b/.test(q)) return { cost: "free-trial-card", label: "free trial" };
  if (/\bfree tier\b/.test(q)) return { cost: "free-tier", label: "free tier" };
  return null;
}

function wordVariants(w: string): string[] {
  const out = new Set([w]);
  if (w.endsWith("s") && !w.endsWith("ss")) out.add(w.slice(0, -1));
  out.add(`${w}s`);
  if (w.endsWith("ian")) out.add(`${w.slice(0, -2)}a`);
  if (w.endsWith("ia")) out.add(`${w}n`);
  if (w === "women") out.add("woman");
  if (w === "men") out.add("man");
  return [...out];
}

function eligibilityMatches(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  return wordVariants(word).some((v) => lower.includes(v));
}

/** Words after "for" in a question like "scholarships for women". */
function detectEligibility(question: string): string[] | null {
  const m = question.match(/\bfor\s+([a-z]{3,}(?:\s+[a-z]{3,})?)/i);
  if (!m) return null;
  const words = m[1]
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !["the", "and", "all", "any", "more", "with"].includes(w));
  return words.length > 0 ? words : null;
}

function detectTrack(tokens: string[]): DisplayTrack | null {
  let best: DisplayTrack | null = null;
  let bestHits = 0;
  for (const [track, words] of Object.entries(TRACK_WORDS)) {
    const hits = words.filter((w) => tokens.includes(w)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = track as DisplayTrack;
    }
  }
  return best;
}

/** The kind of opportunity a question asks about, if it names one.
 *  Exported so the route can restrict judgment guarantees to the
 *  asked kind. */
export function detectQuestionTrack(question: string): DisplayTrack | null {
  return detectTrack(tokenize(question));
}

const VALUE_RE = /\b(biggest|largest|highest|most valuable|best.?paid|highest.?paying|top prizes?|richest|most money)\b/i;

/** "1 opportunity" / "3 opportunities". */
function oppCount(n: number): string {
  return n === 1 ? "1 opportunity" : `${n} opportunities`;
}

function isAre(n: number): string {
  return n === 1 ? "is" : "are";
}

function singularLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.endsWith("ss")) return label;
  if (lower.endsWith("s")) return label.slice(0, -1);
  return label;
}

/** "1 scholarship" / "3 scholarships" / "5 opportunities". */
function countLabel(track: DisplayTrack | null, n: number): string {
  if (!track) return oppCount(n);
  const base = (TRACK_LABELS[track] ?? track).toLowerCase();
  return n === 1 ? `1 ${singularLabel(base)}` : `${n} ${base}`;
}

/** Header plus up to 5 numbered deal items, with a blank line between
 *  items so each one reads as its own entry. */
function listReply(header: string, items: ResolvedDeal[]): string {
  const lines = [header, ""];
  items.slice(0, 5).forEach((d, i) => {
    lines.push(dealItem(d, i + 1), "");
  });
  return lines.join("\n").trimEnd();
}

/** Broad question: counts plus one example per track, with its link. */
function broadReply(deals: ResolvedDeal[]): string {
  const lines = [countsSummary(deals), "Examples:"];
  for (const track of trackOrder(deals)) {
    const inTrack = deals.filter((d) => d.track === track).sort(bySoonest);
    const d = inTrack[0];
    if (d) {
      lines.push(`- **${clean(d.title)}** (${TRACK_LABELS[track] ?? track}) [Official source](${d.sourceUrl})`);
    }
  }
  return lines.join("\n");
}

function countingReply(
  active: ResolvedDeal[],
  question: string,
  tokens: string[],
): DeterministicAnswer | null {
  const track = detectTrack(tokens);
  const window = detectWindow(question);
  const closingSoon = DEADLINE_WORDS.test(question);
  let subset = active;
  if (track) {
    subset = subset.filter((d) => d.track === track);
  }
  if (window) {
    subset = subset.filter(window.predicate);
  } else if (closingSoon) {
    subset = subset.filter(isClosingSoon);
  }
  if (!track && !window && !closingSoon) {
    return { type: "count", reply: countsSummary(active) };
  }
  const examples = [...subset].sort(bySoonest).slice(0, 3);
  const lines = [
    `There ${isAre(subset.length)} ${countLabel(track, subset.length)}${window ? ` closing ${window.label}` : closingSoon ? " closing soon" : ""} on the site.`,
    "",
  ];
  for (const d of examples) lines.push(dealItem(d), "");
  return { type: "count", reply: lines.join("\n").trimEnd() };
}

interface DeterministicAnswer {
  reply: string;
  type: string;
}

/**
 * Answer from the prepared deals when the question matches them with
 * confidence. Returns null when the question needs judgment, opinion or
 * reasoning across listings, so the caller falls through to the model.
 */
export function tryDeterministic(
  deals: ResolvedDeal[],
  question: string,
): DeterministicAnswer | null {
  if (JUDGMENT_RE.test(question)) return null;
  const active = activeDeals(deals);
  if (active.length === 0) return null;
  const tokens = tokenize(question);
  const scored = scoreAll(active, tokens);
  const top = scored[0];
  const strong = !!top && isStrong(top, scored[1]);

  // 1. Comparison of two or more named deals.
  if (COMPARISON_RE.test(question)) {
    const named = scored.filter((s) => s.hits >= 2 || s.score >= 4).slice(0, 3);
    if (named.length >= 2) {
      return { type: "comparison", reply: comparisonReply(named) };
    }
  }

  // 2. One field of a confidently matched deal.
  const field = detectField(question);
  if (field && strong && top) {
    return { type: `deal-${field}`, reply: fieldReply(top.d, field) };
  }

  // 3. Full brief of a confidently matched deal.
  if (strong && top) {
    return { type: "deal-brief", reply: singleDealReply(top.d) };
  }

  // 4. Named but absent: a specific thing the site does not list.
  // Guarded so filter questions that merely start with "what is" do
  // not land here ("what is closing in November", "what is the biggest
  // prize" are window/value questions, not named listings).
  if (
    ABOUT_RE.test(question) &&
    !DEADLINE_WORDS.test(question) &&
    !detectWindow(question) &&
    !VALUE_RE.test(question) &&
    !detectCost(question)
  ) {
    const subject = extractSubject(question);
    const subjectTokens = tokenize(subject);
    const specific = subjectTokens.filter((t) => {
      const forms = wordForms(t);
      return !forms.some((f) => GENERIC_SUBJECT.has(f));
    });
    if (specific.length > 0) {
      const closest = scored.filter((s) => s.score > 0).slice(0, 2);
      return {
        type: "deal-absent",
        reply: absentReply(subject, closest, detectTrack(tokens)),
      };
    }
  }

  // 5. Counting questions.
  if (/\bhow many\b/i.test(question)) {
    const counted = countingReply(active, question, tokens);
    if (counted) return counted;
  }

  // 6. A specific deadline window (month, this week, this month, next week).
  const window = detectWindow(question);
  if (window) {
    const track = detectTrack(tokens);
    let subset = active.filter(window.predicate);
    if (track) subset = subset.filter((d) => d.track === track);
    if (subset.length > 0) {
      const label = countLabel(track, subset.length);
      return {
        type: "filter-window",
        reply: listReply(
          `${label} close${subset.length === 1 ? "s" : ""} ${window.label}:`,
          [...subset].sort(bySoonest),
        ),
      };
    }
    if (track) {
      return {
        type: "filter-window",
        reply: `No ${TRACK_LABELS[track] ?? track} close ${window.label}.`,
      };
    }
  }

  // 7. Cost filter (no card, truly free, free trial, free tier).
  const cost = detectCost(question);
  if (cost) {
    // "card" is the cost cue itself, so it must not also count as the
    // banking track: "which deals need no card" is about every track.
    const track = detectTrack(tokens.filter((t) => t !== "card"));
    let subset = active.filter((d) => d.costType === cost.cost);
    if (track) subset = subset.filter((d) => d.track === track);
    if (subset.length > 0) {
      return {
        type: "filter-cost",
        reply: listReply(
          `${oppCount(subset.length)} ${isAre(subset.length)} ${cost.label}${track ? ` in ${TRACK_LABELS[track] ?? track}` : ""}, soonest closing first:`,
          [...subset].sort(bySoonest),
        ),
      };
    }
  }

  // 8. Eligibility filter ("for women", "for students", ...).
  const eligWords = detectEligibility(question);
  if (eligWords) {
    const track = detectTrack(tokens);
    let subset = active;
    if (track) subset = subset.filter((d) => d.track === track);
    const allMatch = subset.filter((d) =>
      eligWords.every((w) => eligibilityMatches(d.eligibility, w)),
    );
    const anyMatch =
      allMatch.length > 0
        ? allMatch
        : subset.filter((d) => eligWords.some((w) => eligibilityMatches(d.eligibility, w)));
    if (anyMatch.length > 0) {
      return {
        type: "filter-eligibility",
        reply: listReply(
          `${oppCount(anyMatch.length)} match${anyMatch.length === 1 ? "es" : ""} "${eligWords.join(" ")}"${track ? ` in ${TRACK_LABELS[track] ?? track}` : ""}:`,
          [...anyMatch].sort(bySoonest),
        ),
      };
    }
  }

  // 9. Deals closing in the next 14 days.
  if (DEADLINE_WORDS.test(question)) {
    const track = detectTrack(tokens);
    let closing = active.filter(isClosingSoon);
    if (track) closing = closing.filter((d) => d.track === track);
    closing.sort(bySoonest);
    if (closing.length > 0) {
      const label = track
        ? `${TRACK_LABELS[track] ?? track} closing soon`
        : "Opportunities closing soon (next 14 days)";
      return { type: "filter-deadline", reply: listReply(`${label}:`, closing) };
    }
    const label = track ? `${TRACK_LABELS[track] ?? track}` : "opportunities";
    const soonest = [...active]
      .filter((d) => (track ? d.track === track : true))
      .sort(bySoonest)
      .slice(0, 3);
    if (soonest.length === 0) {
      return {
        type: "filter-deadline",
        reply: `No ${label} are listed on the site right now.`,
      };
    }
    return {
      type: "filter-deadline",
      reply: `No ${label} are closing in the next 14 days. The soonest-expiring ${label} are:\n\n${soonest.map((d) => dealItem(d)).join("\n\n")}`,
    };
  }

  // 10. Biggest prizes / highest paying.
  if (VALUE_RE.test(question)) {
    const track = detectTrack(tokens);
    let valued = active.filter((d) => d.valueUsd !== null);
    if (track) {
      const inTrack = valued.filter((d) => d.track === track);
      if (inTrack.length > 0) valued = inTrack;
    }
    valued.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || bySoonest(a, b));
    if (valued.length > 0) {
      return {
        type: "filter-value",
        reply: listReply("The biggest prizes on the site:", valued),
      };
    }
  }

  // 11. One track, top 5 by soonest expiry.
  const track = detectTrack(tokens);
  if (track) {
    const inTrack = active.filter((d) => d.track === track).sort(bySoonest);
    if (inTrack.length > 0) {
      return {
        type: "filter-track",
        reply: listReply(
          `${countLabel(track, inTrack.length)} in total, soonest closing first:`,
          inTrack,
        ),
      };
    }
  }

  // 12. General rule: keywords match a deal with confidence. This runs
  // before the broad check: a one-keyword question such as "Is the
  // Zecathon listed?" matches a single deal and is not a broad question,
  // even though fewer than 5 deals match its keywords. When the
  // question names a kind of opportunity, only that kind is matched:
  // a jobs question is never answered with scholarships.
  if (top && top.score >= 2 && top.hits >= 1) {
    const track = detectTrack(tokens);
    let matched = scored.filter((s) => s.score > 0);
    if (track) matched = matched.filter((s) => s.d.track === track);
    matched = matched.slice(0, 5);
    if (matched.length === 0) return null;
    return {
      type: "filter-keywords",
      reply: listReply("Here are the closest matches:", matched.map((s) => s.d)),
    };
  }

  // 13. Broad question: counts plus one example per track, with links.
  if (isBroadQuestion(active, question)) {
    return { type: "broad", reply: broadReply(active) };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Model reply quality gate                                          */
/* ------------------------------------------------------------------ */

// First-to-answer must not win when its answer is worse: a reply
// that is too short, was cut by the output token cap, ends inside a
// markdown link, ends mid-sentence, or names no source link is
// rejected and the race continues to the next finisher.

/** A reply cut by the output token cap ends inside a markdown link:
 *  "[Source](https://...shared-scholar" with no closing ")". Every
 *  well-formed markdown link closes its paren, so a "](" with no ")"
 *  after it anywhere in the reply means the reply was cut. The old
 *  gate missed this: its bare-URL fallback (/\bhttps?:\/\/\S+\s*$/)
 *  matches a truncated URL fragment exactly like a complete bare
 *  URL, so a reply ending mid-link passed as "ends with a link". */
function hasUnclosedLink(text: string): boolean {
  let from = 0;
  for (;;) {
    const open = text.indexOf("](", from);
    if (open < 0) return false;
    if (text.indexOf(")", open + 2) < 0) return true;
    from = open + 2;
  }
}

/** Provider finish reasons that mean the reply was cut by the output
 *  token cap: Gemini reports "MAX_TOKENS", OpenRouter reports
 *  "length". A normally finished reply reports "STOP" / "stop". */
export function isCutByTokenCap(finishReason: string | undefined): boolean {
  return finishReason === "MAX_TOKENS" || finishReason === "length";
}

export function isGoodModelReply(reply: string, finishReason?: string): {
  ok: boolean;
  reason: string;
} {
  const r = reply.trim();
  if (r.length < 150) return { ok: false, reason: "too short" };
  if (isCutByTokenCap(finishReason)) {
    return { ok: false, reason: "cut off by output token cap" };
  }
  if (hasUnclosedLink(r)) {
    return { ok: false, reason: "truncated link" };
  }
  const endsWithLink =
    /\]\(https?:\/\/[^\s)]+\)\s*$/.test(r) || /\bhttps?:\/\/\S+\s*$/.test(r);
  const last = r[r.length - 1];
  if (!endsWithLink && last !== "." && last !== "!" && last !== "?") {
    return { ok: false, reason: "ends mid-sentence" };
  }
  if (!r.includes("http")) return { ok: false, reason: "no source link" };
  return { ok: true, reason: "" };
}

/* ------------------------------------------------------------------ */
/* Smarter shortlist for judgment questions                          */
/* ------------------------------------------------------------------ */

// Judgment questions ("which fits a physics graduate?") go to the
// model, and the model can only judge what it is shown. A plain
// keyword-ranked sample missed the strongest fits, so the shortlist
// for judgment questions is built from three groups: direct field
// matches (with field expansion), opportunities open to any field,
// and the question's own keyword matches.

export function isJudgmentQuestion(question: string): boolean {
  return JUDGMENT_RE.test(question);
}

/** Extra instruction for judgment questions, used in the route's system
 *  prompt: open-to-all listings are strong fits, not background. The
 *  model kept skipping the any-discipline scholarships because they do
 *  not name the field, so this is said explicitly. */
export const JUDGMENT_OPEN_FIELD_INSTRUCTION =
  "Listings open to all disciplines are strong fits for any graduate. Do not skip them just because they do not name the field. When the question is about a graduate, recommend a mix of field-specific roles and any-discipline scholarships, and name the strongest any-discipline scholarships in the shortlist.";

/** Field expansion for judgment questions: a field named in the
 *  question also matches its neighbouring fields in the listings.
 *  Every value word below was checked to occur in the listings data;
 *  words with zero occurrences (laboratory, mathematics, energy,
 *  medical, clinical, management) were left out. "research" was left
 *  out too: it matches market research and generic listings, not
 *  field-specific fits, and the genuine research fits match through
 *  stem, science, materials or physics instead. */
const FIELD_EXPANSIONS: Record<string, string[]> = {
  physics: ["physics", "stem", "science", "engineering", "materials", "chemistry"],
  computer: ["software", "coding", "programming", "data", "ai", "ml", "machine", "learning", "computer", "developer", "engineering"],
  software: ["software", "coding", "programming", "data", "ai", "ml", "machine", "learning", "computer", "developer", "engineering"],
  programming: ["software", "coding", "programming", "data", "ai", "ml", "machine", "learning", "computer", "developer", "engineering"],
  coding: ["software", "coding", "programming", "data", "ai", "ml", "machine", "learning", "computer", "developer", "engineering"],
  developer: ["software", "coding", "programming", "data", "ai", "ml", "machine", "learning", "computer", "developer", "engineering"],
  data: ["software", "coding", "programming", "data", "ai", "ml", "machine", "learning", "computer", "developer", "engineering"],
  machine: ["ai", "ml", "machine", "learning", "data", "software"],
  learning: ["ai", "ml", "machine", "learning", "data", "software"],
  ai: ["ai", "ml", "machine", "learning", "data", "software"],
  medicine: ["medicine", "health", "biology"],
  health: ["health", "biology"],
  business: ["business", "finance", "entrepreneurship"],
  law: ["law", "legal"],
  design: ["design", "art", "creative"],
  art: ["design", "art", "creative"],
  engineering: ["engineering", "stem", "science", "materials"],
  maths: ["maths", "stem", "science", "data"],
  mathematics: ["maths", "stem", "science", "data"],
  science: ["science", "stem"],
};

/** Wording that says a listing is open to any field of study. Only
 *  phrases that actually occur in the listings data are used: the
 *  bare "open to all" in the data refers to nationality, age or users
 *  ("Open to all nationalities", "Open to all ages", "Open to all
 *  users"), not to fields of study, so it is not matched here. */
const OPEN_FIELD_PHRASES = [
  "all academic disciplines",
  "any field",
  "any discipline",
  "all disciplines",
  "all fields",
  "all subjects",
  "any subject",
  "open to all disciplines",
  "open to all fields",
];

function isOpenField(d: ResolvedDeal): boolean {
  const text = `${d.title} ${d.eligibility} ${d.requirements}`.toLowerCase();
  return OPEN_FIELD_PHRASES.some((p) => text.includes(p));
}

/** Specific fields of study or work. A listing whose title,
 *  eligibility and requirements name none of these is open to any
 *  field, so it belongs in a fit shortlist for any graduate. Words
 *  that also appear as benefits rather than fields (for example
 *  "health" in "health insurance") were left out, since a false
 *  field-open listing in the shortlist is harmless: the model still
 *  judges it, while a missed open listing never gets judged. */
const FIELD_WORDS = new Set([
  "physics", "chemistry", "biology", "biochemistry", "mathematics",
  "maths", "engineering", "medicine", "medical", "nursing", "pharmacy",
  "law", "legal", "business", "economics", "finance", "accounting",
  "computer", "software", "programming", "coding", "data", "agriculture",
  "agronomy", "veterinary", "architecture", "music", "film", "journalism",
  "media", "politics", "policy", "migration", "humanitarian", "geology",
  "astronomy", "statistics", "psychology", "sociology", "history",
  "philosophy", "linguistics", "literature", "teaching", "sports",
  "tourism", "marketing", "logistics", "hospitality", "artificial",
  "machine", "cybersecurity", "robotics", "materials", "development",
  "developer", "engineer", "stem", "electrical",
]);

function isFieldOpen(d: ResolvedDeal): boolean {
  const words = new Set(
    `${d.title} ${d.eligibility} ${d.requirements}`
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [],
  );
  for (const w of FIELD_WORDS) if (words.has(w)) return false;
  return true;
}

/** Wording that restricts a listing to people who are currently
 *  undergraduates. "Undergraduate degree" and "undergraduate
 *  qualification" are deliberately NOT in here: they mean the
 *  applicant must already hold a degree, i.e. a graduate-level
 *  listing (the Mastercard Edinburgh master's scholarship says
 *  "hold an undergraduate degree"). "student" alone is not in here
 *  either: many graduate scholarships say students. */
const UNDERGRAD_ONLY_RE =
  /\b300[-\s]?level\b|\bundergraduate students?\b|\bcurrent undergraduates?\b|\bundergraduates\b/i;

/** A graduate-level mention in the same text keeps the deal in,
 *  even when it also says undergraduate: "undergraduate or graduate
 *  students" is open to graduates. */
const GRADUATE_MENTION_RE =
  /\b(masters?|msc|phd|graduate|graduates|postgraduate|post-graduate|doctoral|doctorate)\b/i;

/** A listing only undergraduates can take: its eligibility or
 *  requirements restrict to current undergraduates (a level or
 *  status) and never mention a graduate level anywhere. Conservative:
 *  ambiguous wording keeps the deal in. Exported for testing. */
export function isUndergraduateOnly(d: ResolvedDeal): boolean {
  const text = `${d.eligibility} ${d.requirements}`;
  if (!UNDERGRAD_ONLY_RE.test(text)) return false;
  return !GRADUATE_MENTION_RE.test(text);
}

/** Whether any of the given words appears in the deal's title.
 *  A title match means the listing is about that field, not just
 *  mentioning it in a long list of fields. */
function titleMatches(d: ResolvedDeal, tokens: string[]): boolean {
  const titleWords = new Set(
    d.title.toLowerCase().match(/[a-z0-9]+/g) ?? [],
  );
  for (const token of tokens) {
    for (const form of wordVariants(token)) {
      if (titleWords.has(form)) return true;
    }
  }
  return false;
}

/** Shortlist for judgment questions: direct field matches first
 *  (with field expansion), then listings open to any field, then the
 *  question's own keyword matches. The snapshot caps in the route
 *  still cut the list to size; only its contents get smarter. */
export function rankJudgmentShortlist(
  deals: ResolvedDeal[],
  question: string,
): ResolvedDeal[] {
  // Expired listings are already out: activeDeals drops any deal whose
  // expiresOn is before today. For graduate questions, listings only
  // undergraduates can take are out too (see isUndergraduateOnly):
  // the MTN Foundation Scholarship reached the model in run 14 even
  // though its own listing says 300-level students and its 2026 cycle
  // closed 27 Oct 2026, and the model recommended it to a physics
  // graduate. Its expiresOn is null (the deadline lives only in the
  // risk note), so the expired filter alone cannot catch it.
  const active = activeDeals(deals);
  const graduateQuestion = /\bgraduates?\b/i.test(question);
  let shortlistable = graduateQuestion
    ? active.filter((d) => !isUndergraduateOnly(d))
    : active;
  const tokens = tokenize(question);
  // A question that names a kind of opportunity (jobs, scholarships,
  // grants...) is judged only within that kind: a jobs question must
  // never be answered with scholarships, however strong they are.
  const askedTrack = detectTrack(tokens);
  if (askedTrack) {
    shortlistable = shortlistable.filter((d) => d.track === askedTrack);
  }
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const extra = FIELD_EXPANSIONS[t];
    if (extra) for (const w of extra) expanded.add(w);
  }
  const expandedTokens = [...expanded];
  // A direct field match is a listing about the field (an expansion
  // word in its title) or a strong multi-word match. A single shared
  // word is not enough: "science" also matches "social science" and
  // "Agricultural Sciences", and generic listings that enumerate many
  // fields ("engineering, science, law, finance...") would otherwise
  // match every field question.
  const groupA = shortlistable
    .map((d) => ({ d, score: scoreDeal(d, expandedTokens) }))
    .filter(
      (s) =>
        s.score >= 3 || titleMatches(s.d, expandedTokens),
    )
    .sort((a, b) => b.score - a.score || bySoonest(a.d, b.d))
    .map((s) => s.d);
  const groupB = shortlistable.filter(isOpenField).sort(bySoonest);
  // Open-to-any-field listings, scholarships first: for a graduate
  // asking what fits them, the open scholarships are the strongest
  // candidates, so they come before open jobs and tools.
  const groupC = shortlistable
    .filter(isFieldOpen)
    .sort(
      (a, b) =>
        (a.track === "scholarships" ? 0 : 1) -
          (b.track === "scholarships" ? 0 : 1) || bySoonest(a, b),
    );
  // Weaker field or keyword matches last: they stay in the shortlist
  // for the model to see if the snapshot ever reaches them, but they
  // do not take space from the direct matches and open listings.
  const groupD = scoreAll(shortlistable, expandedTokens)
    .filter((s) => s.score > 0)
    .map((s) => s.d);
  const seen = new Set<number>();
  const out: ResolvedDeal[] = [];
  for (const d of [...groupA, ...groupB, ...groupC, ...groupD]) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}

/** Deals ordered for this question: deadline deals first when the user
 *  asks about deadlines, then best keyword matches, then soonest expiry. */
export function rankDeals(deals: ResolvedDeal[], question: string): ResolvedDeal[] {
  const tokens = tokenize(question);
  const deadlineAsked = DEADLINE_WORDS.test(question);
  const scored = deals.map((d) => ({ d, score: scoreDeal(d, tokens) }));
  const closing = scored
    .filter(({ d }) => isClosingSoon(d))
    .sort((a, b) => (daysLeft(a.d) ?? 99) - (daysLeft(b.d) ?? 99))
    .map(({ d }) => d);
  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (daysLeft(a.d) ?? 99) - (daysLeft(b.d) ?? 99))
    .map(({ d }) => d);
  const seen = new Set<number>();
  const ordered: ResolvedDeal[] = [];
  const push = (d: ResolvedDeal) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      ordered.push(d);
    }
  };
  if (deadlineAsked) closing.forEach(push);
  matched.forEach(push);
  if (matched.length === 0 && !deadlineAsked) {
    // Broad question (e.g. "what is listed"): a spread across tracks.
    const byTrack = new Map<string, ResolvedDeal[]>();
    for (const { d } of scored) {
      const list = byTrack.get(d.track) ?? [];
      list.push(d);
      byTrack.set(d.track, list);
    }
    for (const list of byTrack.values()) {
      list
        .sort((a, b) => (daysLeft(a) ?? 99) - (daysLeft(b) ?? 99))
        .slice(0, 2)
        .forEach(push);
    }
  }
  // Fill any remaining room with the soonest-expiring deals not yet listed.
  scored
    .sort((a, b) => (daysLeft(a.d) ?? 99) - (daysLeft(b.d) ?? 99))
    .map(({ d }) => d)
    .forEach(push);
  return ordered;
}

function compactDeal(d: ResolvedDeal) {
  return {
    title: d.title,
    track: d.track,
    value: d.estimatedValue,
    eligibility: d.eligibility.slice(0, 200),
    expiresOn: d.expiresOn,
    sourceUrl: d.sourceUrl,
    requirements: d.requirements.slice(0, 300),
  };
}

/** Today's date in the user's timezone, for the system prompt. */
export function todayLine(): string {
  const now = new Date();
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", ...opts }).format(now);
  return `Today is ${fmt({ weekday: "long" })} ${fmt({ day: "numeric" })} ${fmt({ month: "long" })} ${fmt({ year: "numeric" })}.`;
}

/** Counts of the full list, by track. */
function trackCounts(deals: ResolvedDeal[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of deals) {
    counts.set(d.track, (counts.get(d.track) ?? 0) + 1);
  }
  return counts;
}

/** Tracks ordered by count, largest first (the counts order). */
function trackOrder(deals: ResolvedDeal[]): string[] {
  return [...trackCounts(deals).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([track]) => track);
}

/** How many deals match the question's keywords at all. */
function matchedDealCount(deals: ResolvedDeal[], question: string): number {
  const tokens = tokenize(question);
  let n = 0;
  for (const d of deals) {
    if (scoreDeal(d, tokens) > 0) n += 1;
  }
  return n;
}

/** A broad question asks about the whole list without naming a deadline,
 *  a track or a programme: fewer than 5 deals match its keywords. */
export function isBroadQuestion(deals: ResolvedDeal[], question: string): boolean {
  if (DEADLINE_WORDS.test(question)) return false;
  return matchedDealCount(deals, question) < 5;
}

/** One short example per display track (title, track, expiry only),
 *  ordered by the counts order. Used for broad questions only, so the
 *  model sees the shape of the list without a long ranked sample. */
export function buildBroadSnapshot(deals: ResolvedDeal[]): string {
  const entries: { title: string; track: string; expiresOn: string | null }[] = [];
  for (const track of trackOrder(deals)) {
    const inTrack = deals.filter((d) => d.track === track);
    inTrack.sort((a, b) => (daysLeft(a) ?? 99) - (daysLeft(b) ?? 99));
    const d = inTrack[0];
    if (d) entries.push({ title: d.title, track: d.track, expiresOn: d.expiresOn });
  }
  return JSON.stringify(entries);
}

/** Counts of the full list, by track, for the counts summary. */
export const TRACK_LABELS: Record<string, string> = {
  scholarships: "scholarships",
  grants: "grants",
  hackathons: "hackathons",
  competitions: "competitions",
  jobs: "remote jobs",
  "ai-tools": "AI tools",
  cloud: "cloud",
  software: "software",
  banking: "banking",
  crypto: "crypto",
};

export function countsSummary(deals: ResolvedDeal[]): string {
  const counts = trackCounts(deals);
  const parts = trackOrder(deals).map(
    (track) => `${counts.get(track)} ${TRACK_LABELS[track] ?? track}`,
  );
  return `The full list has ${deals.length} opportunities: ${parts.join(", ")}.`;
}

/** Snapshot of the ranked deals, cut at maxChars without breaking a deal. */
export function buildSnapshot(ranked: ResolvedDeal[], maxChars: number): string {
  return buildSnapshotFrom(ranked, maxChars, compactDeal);
}

/** Slimmer deal shape for judgment questions: the model needs breadth
 *  (the right candidates in view) more than full requirement text, so
 *  eligibility and requirements are trimmed and more deals fit. */
function compactJudgmentDeal(d: ResolvedDeal) {
  return {
    title: d.title,
    track: d.track,
    value: d.estimatedValue,
    eligibility: shorten(d.eligibility, 70),
    expiresOn: d.expiresOn,
    sourceUrl: d.sourceUrl,
    requirements: shorten(d.requirements, 60),
  };
}

/** Judgment snapshot: the shortlist split into two labelled sections so
 *  the model sees the open-to-all scholarships as a distinct relevant
 *  group instead of background. Field-specific fits first, then the
 *  listings open to any discipline, scholarships first within that
 *  section (they are the strongest fits for a graduate). The open
 *  section is built first, up to 60% of the budget, so it is never
 *  squeezed out of the snapshot by the field section. The same
 *  deals and the same 8,000-char cap as before; only the presentation
 *  changes. */
export function buildJudgmentSnapshot(
  ranked: ResolvedDeal[],
  maxChars: number,
): string {
  const FIELD_HEADER = "Field-specific fits:";
  const OPEN_HEADER = "Open to all disciplines, any graduate can apply:";
  const open = ranked.filter((d) => isOpenField(d) || isFieldOpen(d));
  const field = ranked.filter((d) => !isOpenField(d) && !isFieldOpen(d));
  const headers =
    open.length > 0
      ? FIELD_HEADER.length + 1 + OPEN_HEADER.length + 1 + 1
      : FIELD_HEADER.length + 1;
  const arraysBudget = Math.max(0, maxChars - headers);
  // The open section holds the any-discipline scholarships the model
  // kept skipping, so it is built first (up to 60% of the budget) and
  // the field section takes the remainder. The printed order is still
  // field section first, open section second. A field-first budget
  // starved the open section: Stipendium Hungaricum (latest deadline
  // of the open scholarships) was cut from the snapshot.
  const openOrdered = [...open].sort(
    (a, b) =>
      (a.track === "scholarships" ? 0 : 1) -
        (b.track === "scholarships" ? 0 : 1) || bySoonest(a, b),
  );
  const openText =
    open.length > 0
      ? buildSnapshotFrom(
          openOrdered,
          Math.floor(arraysBudget * 0.6),
          compactJudgmentDeal,
        )
      : "";
  const fieldText = buildSnapshotFrom(
    field,
    Math.max(0, arraysBudget - openText.length),
    compactJudgmentDeal,
  );
  const sections = [`${FIELD_HEADER}\n${fieldText}`];
  if (open.length > 0) sections.push(`${OPEN_HEADER}\n${openText}`);
  return sections.join("\n");
}

function buildSnapshotFrom(
  ranked: ResolvedDeal[],
  maxChars: number,
  compact: (d: ResolvedDeal) => object,
): string {
  const parts: string[] = ["["];
  let length = 1;
  for (const d of ranked) {
    const piece = JSON.stringify(compact(d));
    const extra = piece.length + (parts.length > 1 ? 1 : 0);
    if (length + extra > maxChars && parts.length > 1) break;
    if (length + extra > maxChars) {
      // A single deal alone is too long: keep it trimmed rather than empty.
      parts.push(piece.slice(0, Math.max(0, maxChars - length - 2)));
      break;
    }
    if (parts.length > 1) parts.push(",");
    parts.push(piece);
    length += extra;
  }
  parts.push("]");
  return parts.join("");
}

/* ------------------------------------------------------------------ */
/* Deterministic guarantee for judgment answers                      */
/* ------------------------------------------------------------------ */

// The model kept dropping the strongest any-discipline scholarships
// even when they were in its shortlist (run 13 named 4 of 6 and
// missed Gates Cambridge and Stipendium Hungaricum), so the route
// appends any it fails to name. The pool is the flagship
// any-discipline scholarships, matched by distinctive title
// substrings: taking the soonest-expiring open scholarships
// literally would append the filmmaking academy and the two
// Mastercard programmes that close first, not the strongest fits.

/** Distinctive substrings of the flagship any-discipline scholarship
 *  titles, matched case-insensitively against both deal titles and
 *  the model reply. */
const FLAGSHIP_OPEN_KEYS = [
  "daad",
  "commonwealth shared",
  "gates cambridge",
  "stipendium hungaricum",
  "erasmus mundus",
];

/** The open-section deals of a judgment shortlist: listings open to
 *  any field of study. */
export function openSectionDeals(ranked: ResolvedDeal[]): ResolvedDeal[] {
  return ranked.filter((d) => isOpenField(d) || isFieldOpen(d));
}

/** Append the flagship any-discipline scholarships the model reply
 *  failed to name, soonest-expiring first, at most 3. Returns the
 *  reply unchanged when none are missing, when the open section has
 *  no flagship scholarships, or when the reply is a refusal. */
export function appendMissingOpenScholarships(
  reply: string,
  openDeals: ResolvedDeal[],
): { reply: string; appended: number } {
  const unchanged = { reply, appended: 0 };
  if (
    /could not answer|couldn't answer|cannot (help|answer)|unable to answer/i.test(
      reply,
    )
  ) {
    return unchanged;
  }
  // One entry per flagship key: several deals can share a name (the
  // feed lists Commonwealth Shared twice), so keep the
  // soonest-expiring deal per key.
  const byKey = new Map<string, ResolvedDeal>();
  for (const d of openDeals) {
    if (d.track !== "scholarships") continue;
    const title = d.title.toLowerCase();
    for (const key of FLAGSHIP_OPEN_KEYS) {
      if (!title.includes(key)) continue;
      const prev = byKey.get(key);
      if (!prev || bySoonest(d, prev) < 0) byKey.set(key, d);
    }
  }
  const lower = reply.toLowerCase();
  const missing = [...byKey.entries()]
    .filter(([key]) => !lower.includes(key))
    .map(([, d]) => d)
    .sort(bySoonest)
    .slice(0, 3);
  if (missing.length === 0) return unchanged;
  const lines = ["Also open to you as a graduate:", ""];
  for (const d of missing) lines.push(dealItem(d), "");
  return {
    reply: `${reply.trimEnd()}\n\n${clean(lines.join("\n").trimEnd())}`,
    appended: missing.length,
  };
}

/** The field-section deals of a judgment shortlist: listings about a
 *  specific field, as opposed to the open-to-any-field section. */
export function fieldSectionDeals(ranked: ResolvedDeal[]): ResolvedDeal[] {
  return ranked.filter((d) => !isOpenField(d) && !isFieldOpen(d));
}

/** Words that carry no identity in a listing title: vendor names,
 *  generic role words, levels and rates. Dropped when deriving the
 *  phrase that identifies a deal in a model reply. */
const GENERIC_TITLE_WORDS = new Set([
  "mercor", "turing", "micro1", "google", "meta", "microsoft", "amazon",
  "apple", "openai", "binance", "mastercard", "mtn", "huawei", "nasa",
  "mlh", "kaggle", "coursera", "udemy", "deepgram", "groq", "jetbrains",
  "github", "notion", "oracle", "cloudflare", "vultr", "near", "solana",
  "ethereum", "bnb", "expert", "experts", "role", "roles", "remote",
  "job", "jobs", "contract", "contracts", "specialist", "specialists",
  "engineer", "engineers", "developer", "developers", "program",
  "programme", "programs", "programmes", "opportunity", "opportunities",
  "free", "paid", "full", "time", "online", "global", "worldwide",
  "nigeria", "nigerian", "africa", "msc", "phd", "bsc", "masters",
  "master", "undergraduate", "graduate", "hr", "hrs", "per", "week",
  "month", "year", "senior", "junior", "lead",
]);

/** Normalize text for name matching: lowercase, punctuation and
 *  dashes become spaces, whitespace collapsed. */
function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words that identify a deal in a model reply: the first three
 *  content words of its short title. Order-independent: the model
 *  may write "Turing STEM Annotator" where the title says
 *  "Turing: Annotator, STEM". A single content word is not enough
 *  (a passing mention would count as naming it), so those deals fall
 *  back to the full normalized short title. */
function dealKeyWords(d: ResolvedDeal): string[] | null {
  const words = normalizeName(shortTitle(d))
    .split(" ")
    .filter(
      (w) => w.length > 0 && !GENERIC_TITLE_WORDS.has(w) && !/^\d+$/.test(w),
    );
  if (words.length >= 2) return words.slice(0, 3);
  return null;
}

/** Whether the model reply names this deal: all of its key words
 *  appear as whole words in the reply, or the full short title
 *  appears for single-word deals. Errs toward "not named" (append):
 *  a duplicate line is harmless, a missed strongest fit is not. */
function dealNamedInReply(reply: string, d: ResolvedDeal): boolean {
  const replyWords = new Set(
    normalizeName(reply).split(" ").filter(Boolean),
  );
  const keys = dealKeyWords(d);
  if (keys) return keys.every((w) => replyWords.has(w));
  return normalizeName(reply).includes(normalizeName(shortTitle(d)));
}

/** Append the strongest field-specific roles the model reply failed
 *  to name. Mirrors appendMissingOpenScholarships for the field
 *  section: the model dropped the strongest physics fit in run 14
 *  (Atomistic Materials Modeling Expert, $84/hr) while naming a
 *  generic STEM role instead. The window is the top 3 by fit order,
 *  not 2: the keyword score ranks the two generic STEM umbrella
 *  roles above the strongest physics-specific fit (Atomistic is 3rd
 *  in the physics shortlist), so a top-2 window would append the
 *  generic roles and still miss it. Returns the reply unchanged when
 *  none are missing or when the reply is a refusal. */
export function appendMissingFieldRoles(
  reply: string,
  fieldDeals: ResolvedDeal[],
): { reply: string; appended: number } {
  const unchanged = { reply, appended: 0 };
  if (
    /could not answer|couldn't answer|cannot (help|answer)|unable to answer/i.test(
      reply,
    )
  ) {
    return unchanged;
  }
  const missing = fieldDeals
    .slice(0, 3)
    .filter((d) => !dealNamedInReply(reply, d));
  if (missing.length === 0) return unchanged;
  const lines = ["Also a strong fit for your field:", ""];
  for (const d of missing) lines.push(dealItem(d), "");
  return {
    reply: `${reply.trimEnd()}\n\n${clean(lines.join("\n").trimEnd())}`,
    appended: missing.length,
  };
}

