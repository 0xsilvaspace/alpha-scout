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
const TRACK_WORDS: Record<string, string[]> = {
  scholarships: ["scholarship", "scholarships", "masters", "phd", "study"],
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

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}...`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

/** "30 November 2026 (in 18 days)", "(today)", "(tomorrow)", or "Ongoing". */
function deadlineText(d: ResolvedDeal): string {
  if (!d.expiresOn) return "Ongoing, no closing date";
  const left = daysLeft(d);
  const date = formatDate(d.expiresOn);
  if (left === null) return date;
  if (left < 0) return `${date} (closed)`;
  if (left === 0) return `${date} (today)`;
  if (left === 1) return `${date} (tomorrow)`;
  return `${date} (in ${left} days)`;
}

/** One short line per deal: title, value, deadline, official source. */
function dealLine(d: ResolvedDeal): string {
  return `- **${clean(d.title)}**: ${truncate(clean(d.estimatedValue), 80)}, closes ${deadlineText(d)}. [Official source](${d.sourceUrl})`;
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

/** One sentence saying who the opportunity is for. Eligibility text
 *  that starts with "Open to" becomes "It is for ..."; anything else
 *  stands as its own sentence. */
function whoItIsFor(d: ResolvedDeal): string {
  const elig = truncate(clean(d.eligibility), 200).replace(/[.;\s]+$/, "");
  if (!elig) return "";
  const m = elig.match(/^open to\s+/i);
  if (m) return `It is for ${lowerFirst(elig.slice(m[0].length))}.`;
  return `${elig}.`;
}

/** Full brief of one deal, written like an assistant answering: a
 *  natural opening, the key facts in clean sentences, and the
 *  official source on its own line. Not a dump of field labels. */
function singleDealReply(d: ResolvedDeal): string {
  const lines: string[] = [`**${clean(d.title)}**`, ""];
  const value = clean(d.estimatedValue).trim().replace(/[.;\s]+$/, "");
  if (value) lines.push(`${value}.`);
  lines.push(
    d.expiresOn
      ? `Applications close on ${deadlineText(d)}.`
      : "No closing date is listed.",
  );
  const who = whoItIsFor(d);
  if (who) lines.push(who);
  const req = truncate(clean(d.requirements), 250).replace(/[.;\s]+$/, "");
  if (req) lines.push(`${req}.`);
  const steps = truncate(clean(d.actionSteps), 300).replace(/[.;\s]+$/, "");
  if (steps) lines.push(`To apply, ${lowerFirst(steps)}.`);
  lines.push("", `Official source: ${d.sourceUrl}`);
  return lines.join("\n");
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
  const value = clean(d.estimatedValue).trim().replace(/[.;\s]+$/, "");
  const deadlineLine = d.expiresOn
    ? `Applications close on ${deadlineText(d)}.`
    : "No closing date is listed.";
  switch (field) {
    case "deadline":
      return `${title}\n\n${deadlineLine}${value ? ` ${value}.` : ""}\n\nOfficial source: ${d.sourceUrl}`;
    case "value":
      return `${title}\n\n${value ? `${value}. ` : ""}${deadlineLine}\n\nOfficial source: ${d.sourceUrl}`;
    case "requirements": {
      const who = whoItIsFor(d);
      const req = truncate(clean(d.requirements), 250).replace(/[.;\s]+$/, "");
      return `${title}\n\n${who ? `${who} ` : ""}${req ? `${req}.` : ""}\n\nOfficial source: ${d.sourceUrl}`;
    }
    case "steps": {
      const steps = truncate(clean(d.actionSteps), 300).replace(/[.;\s]+$/, "");
      return `${title}\n\n${steps ? `To apply, ${lowerFirst(steps)}. ` : ""}${deadlineLine}\n\nOfficial source: ${d.sourceUrl}`;
    }
  }
}

const COMPARISON_RE = /\bcompare\b|\bvs\.?\b|versus|which is better|difference between/i;

/** Side-by-side facts for each named deal, in a tidy layout with
 *  matching facts per deal, plus one closing sentence on the main
 *  difference. No winner is picked. */
function comparisonReply(named: ScoredDeal[]): string {
  const lines = ["Here is how they compare:", ""];
  for (const s of named) {
    const d = s.d;
    const value = clean(d.estimatedValue).trim().replace(/[.;\s]+$/, "");
    const elig = truncate(clean(d.eligibility), 120).replace(/[.;\s]+$/, "");
    lines.push(`**${clean(d.title)}**`);
    if (value) lines.push(`${value}.`);
    lines.push(
      d.expiresOn ? `Closes ${deadlineText(d)}.` : "No closing date is listed.",
    );
    if (elig) lines.push(`${elig}.`);
    lines.push(`[Official source](${d.sourceUrl})`, "");
  }
  const dated = named
    .filter((s) => s.d.expiresOn)
    .sort((a, b) => bySoonest(a.d, b.d));
  if (
    dated.length >= 2 &&
    dated[0].d.expiresOn !== dated[dated.length - 1].d.expiresOn
  ) {
    lines.push(
      `${clean(dated[0].d.title)} closes first, on ${formatDate(dated[0].d.expiresOn as string)}, while ${clean(dated[dated.length - 1].d.title)} runs until ${formatDate(dated[dated.length - 1].d.expiresOn as string)}.`,
    );
  } else {
    const valued = named
      .filter((s) => s.d.valueUsd !== null)
      .sort((a, b) => (b.d.valueUsd ?? 0) - (a.d.valueUsd ?? 0));
    if (
      valued.length >= 2 &&
      valued[0].d.valueUsd !== valued[valued.length - 1].d.valueUsd
    ) {
      lines.push(
        `${clean(valued[0].d.title)} lists the highest value at ${clean(valued[0].d.estimatedValue)}.`,
      );
    } else {
      lines.push(
        "They differ mainly in eligibility and focus, so check the official source for the one that fits you.",
      );
    }
  }
  return lines.join("\n").trimEnd();
}

/** Questions that need judgment or a recommendation go to the model,
 *  never to the deterministic layer. */
const JUDGMENT_RE = /\b(should i|recommend|suggest|best for me|right for me|good for me|which (one )?should|what should i|fits? (a|an|me|my)|suited? (for|to)|help me (choose|pick|decide))\b/i;

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

function absentReply(subject: string, closest: ScoredDeal[]): string {
  const lines = [`I could not find a ${subject} on the site.`];
  if (closest.length > 0) {
    lines.push("The closest matches are:");
    for (const s of closest) lines.push(dealLine(s.d));
  }
  lines.push("Check the site for the full list of opportunities.");
  return lines.join("\n");
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

/** Header plus up to 5 deal lines. */
function listReply(header: string, items: ResolvedDeal[]): string {
  const lines = [header];
  for (const d of items.slice(0, 5)) lines.push(dealLine(d));
  return lines.join("\n");
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
  ];
  for (const d of examples) lines.push(dealLine(d));
  return { type: "count", reply: lines.join("\n") };
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
      return { type: "deal-absent", reply: absentReply(subject, closest) };
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
          `${oppCount(subset.length)} ${isAre(subset.length)} ${cost.label}${track ? ` in ${TRACK_LABELS[track] ?? track}` : ""}, here ${subset.length === 1 ? "it is" : "are 5"} (soonest closing first):`,
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
      reply: `No ${label} are closing in the next 14 days. The soonest-expiring ${label} are:\n${soonest.map(dealLine).join("\n")}`,
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
          `${countLabel(track, inTrack.length)} in total${inTrack.length === 1 ? "" : ", here are 5"}:`,
          inTrack,
        ),
      };
    }
  }

  // 12. General rule: keywords match a deal with confidence. This runs
  // before the broad check: a one-keyword question such as "Is the
  // Zecathon listed?" matches a single deal and is not a broad question,
  // even though fewer than 5 deals match its keywords.
  if (top && top.score >= 2 && top.hits >= 1) {
    const matched = scored.filter((s) => s.score > 0).slice(0, 5);
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
  const active = activeDeals(deals);
  const tokens = tokenize(question);
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
  const groupA = active
    .map((d) => ({ d, score: scoreDeal(d, expandedTokens) }))
    .filter(
      (s) =>
        s.score >= 3 || titleMatches(s.d, expandedTokens),
    )
    .sort((a, b) => b.score - a.score || bySoonest(a.d, b.d))
    .map((s) => s.d);
  const groupB = active.filter(isOpenField).sort(bySoonest);
  // Open-to-any-field listings, scholarships first: for a graduate
  // asking what fits them, the open scholarships are the strongest
  // candidates, so they come before open jobs and tools.
  const groupC = active
    .filter(isFieldOpen)
    .sort(
      (a, b) =>
        (a.track === "scholarships" ? 0 : 1) -
          (b.track === "scholarships" ? 0 : 1) || bySoonest(a, b),
    );
  // Weaker field or keyword matches last: they stay in the shortlist
  // for the model to see if the snapshot ever reaches them, but they
  // do not take space from the direct matches and open listings.
  const groupD = scoreAll(active, expandedTokens)
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
const TRACK_LABELS: Record<string, string> = {
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
    eligibility: truncate(d.eligibility, 70),
    expiresOn: d.expiresOn,
    sourceUrl: d.sourceUrl,
    requirements: truncate(d.requirements, 60),
  };
}

/** Judgment snapshot: same cut as buildSnapshot, slimmer per deal. */
export function buildJudgmentSnapshot(
  ranked: ResolvedDeal[],
  maxChars: number,
): string {
  return buildSnapshotFrom(ranked, maxChars, compactJudgmentDeal);
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

