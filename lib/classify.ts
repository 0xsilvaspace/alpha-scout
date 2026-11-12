/**
 * ALPHA SCOUT — display classification and dedupe.
 *
 * The live feed (and the baked-in fallback) carry the Space's raw tracks
 * (scholarships, jobs, ai-tools, crypto, nfts, banking, cloud, software).
 * The app re-classifies every deal at load time, so the rules below apply
 * equally to the feed and the fallback, and survive future 4-hour feed
 * syncs that re-push the same raw data. Raw feed data is never edited.
 *
 * Display tracks: Scholarships, Grants, AI Tools, Hackathons, Competitions,
 * Remote Jobs, Cloud, Software, Banking, Crypto. NFTs no longer exist as a
 * tab: NFT minting tools go to Software, mint events/whitelists go to
 * Crypto, and hackathons go to Hackathons. Grants are real grants only
 * (government, industry, foundations, universities) — AI Grants vs Other
 * Grants by whether they fund AI work. Chain-foundation builder grants
 * (Solana, Ethereum, BNB, NEAR, OKX, Superteam and similar) stay in Crypto:
 * they are ecosystem funding, not grants in the usual sense. Competition
 * deals are detected by title keywords and beat every tab except
 * Hackathons.
 *
 * Dedupe: each opportunity appears exactly once. Deals are grouped when
 * they share a normalised source URL, or when their normalised title key
 * matches (bag of significant title words after stripping descriptors,
 * parentheticals, years, amounts and filler words). Within a group the
 * single best entry is kept: verified first, then most complete, then
 * latest expiry, then newest.
 */

import { daysLeft, type Deal, type Track } from "./deals";

export type DisplayTrack =
  | "scholarships"
  | "grants"
  | "ai-tools"
  | "hackathons"
  | "competitions"
  | "jobs"
  | "cloud"
  | "software"
  | "banking"
  | "crypto";

export const DISPLAY_LABELS: Record<DisplayTrack, string> = {
  scholarships: "Scholarships",
  grants: "Grants",
  "ai-tools": "AI Tools",
  hackathons: "Hackathons",
  competitions: "Competitions",
  jobs: "Remote Jobs",
  cloud: "Cloud",
  software: "Software",
  banking: "Banking",
  crypto: "Crypto",
};

export type GrantKind = "ai" | "other";

export interface ResolvedDeal extends Omit<Deal, "track"> {
  /** Display track after re-classification (never "nfts"). */
  track: DisplayTrack;
  rawTrack: Track;
  grantKind?: GrantKind;
  /** Funder / provider name, derived from the title or source domain. */
  funder: string;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const HACKATHON_RE =
  /hackathon|buildathon|hack-a-thon|zecathon|robomaster|space apps|hack week/i;
/**
 * Competition titles. "challenge" and "games" are deliberately broad —
 * robotics and coding competitions are named that way — but hackathons
 * are checked first and keep their own tab.
 */
const COMPETITION_RE = /competition|contest|\bcup\b|games|challenge/i;
const GRANT_RE = /grant|subsidy|subsidies/i;
const AI_HINT_RE =
  /artificial intelligence|\bAI\b|machine learning|large language|\bLLM\b|neural|generative ai|ai agent/i;
/** Chain-foundation / ecosystem funders: their builder grants are Crypto, not Grants. */
const CHAIN_FUNDER_RE =
  /solana|ethereum|bnb|near|okx|superteam|base|arbitrum|polygon|avalanche|chainlink/i;

/** [pattern, display name] — first match wins. */
const FUNDERS: [RegExp, string][] = [
  [/solana/i, "Solana Foundation"],
  [/ethereum foundation/i, "Ethereum Foundation"],
  [/bnb/i, "BNB Chain"],
  [/superteam/i, "Superteam"],
  [/okx/i, "OKX"],
  [/\bnear\b/i, "NEAR"],
  [/tony elumelu/i, "Tony Elumelu Foundation"],
  [/anzisha/i, "Anzisha Prize"],
  [/cartier/i, "Cartier Women's Initiative"],
  [/smedan/i, "SMEDAN"],
  [/\b3mtt\b/i, "3MTT"],
  [/mtn foundation/i, "MTN Foundation"],
  [/lingua/i, "LINGUA Africa"],
  [/huawei/i, "Huawei"],
  [/first robotics/i, "FIRST"],
  [/\bvex\b/i, "VEX Robotics"],
  [/imagine cup/i, "Microsoft"],
  [/kaggle/i, "Kaggle"],
  [/daad/i, "DAAD"],
  [/mastercard/i, "Mastercard Foundation"],
  [/erasmus/i, "Erasmus Mundus"],
  [/commonwealth/i, "Commonwealth (CSC)"],
  [/gates cambridge/i, "Gates Cambridge"],
  [/sciences po/i, "Sciences Po"],
  [/openai/i, "OpenAI"],
  [/anthropic/i, "Anthropic"],
  [/google/i, "Google"],
  [/github/i, "GitHub"],
  [/jetbrains/i, "JetBrains"],
  [/microsoft|azure/i, "Microsoft"],
  [/oracle/i, "Oracle"],
  [/amazon|\baws\b/i, "Amazon Web Services"],
  [/mistral/i, "Mistral AI"],
  [/\bmeta\b/i, "Meta"],
  [/cloudflare/i, "Cloudflare"],
  [/assemblyai/i, "AssemblyAI"],
  [/inception/i, "Inception"],
  [/mlh/i, "MLH"],
  [/turing/i, "Turing"],
  [/mercor/i, "Mercor"],
  [/micro1/i, "micro1"],
  [/outlier/i, "Outlier"],
  [/remotasks/i, "Remotasks"],
  [/grey/i, "Grey"],
  [/cleva/i, "Cleva"],
  [/payoneer/i, "Payoneer"],
  [/wise/i, "Wise"],
  [/chipper/i, "Chipper Cash"],
  [/fundall/i, "Fundall"],
  [/astropay/i, "AstroPay"],
  [/getplu/i, "GetPlu"],
  [/worldfirst/i, "WorldFirst"],
  [/rarible/i, "Rarible"],
  [/opensea/i, "OpenSea"],
  [/notion/i, "Notion"],
  [/figma/i, "Figma"],
  [/affinity|canva/i, "Canva"],
  [/app.?sumo/i, "AppSumo"],
  [/multcloud/i, "MultCloud"],
  [/ashampoo/i, "Ashampoo"],
  [/vovsoft/i, "Vovsoft"],
  [/winxvideo/i, "WinXvideo"],
  [/speechmatics/i, "Speechmatics"],
  [/you\.com/i, "You.com"],
  [/groq/i, "Groq"],
  [/openrouter/i, "OpenRouter"],
  [/soso/i, "SoSoValue"],
  [/mitosis/i, "Mitosis"],
  [/asentum/i, "Asentum"],
  [/elyon/i, "ELYON"],
  [/saturn/i, "Saturn"],
  [/miaoushi/i, "Miaoushi"],
  [/binance/i, "Binance"],
];

export function funderName(deal: Deal): string {
  const hay = `${deal.title} ${deal.estimatedValue}`;
  for (const [re, name] of FUNDERS) {
    if (re.test(hay)) return name;
  }
  try {
    const host = new URL(deal.sourceUrl).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "Official source";
  }
}

function grantKindFor(deal: Deal): GrantKind {
  // Audit subsidies fund security work, not AI work.
  if (/audit/i.test(deal.title)) return "other";
  const text = `${deal.title} ${deal.estimatedValue} ${deal.requirements}`;
  // AI Grants = grants funding AI work; everything else is Other Grants.
  if (AI_HINT_RE.test(text)) return "ai";
  return "other";
}

export function resolveDeal(deal: Deal): ResolvedDeal {
  const base = { ...deal, rawTrack: deal.track, funder: funderName(deal) };

  // Hackathons win over everything, including competitions.
  if (HACKATHON_RE.test(deal.title)) {
    return { ...base, track: "hackathons" };
  }

  // Competitions beat every other tab except Hackathons.
  if (COMPETITION_RE.test(deal.title)) {
    return { ...base, track: "competitions" };
  }

  if (deal.track === "nfts") {
    // Minting tools/platforms go to Software; mint events, whitelists
    // and passes go to Crypto (on-chain mint opportunities).
    if (/rarible|opensea/i.test(deal.title) && /mint/i.test(deal.title)) {
      return { ...base, track: "software" };
    }
    return { ...base, track: "crypto" };
  }

  if (GRANT_RE.test(deal.title)) {
    // Chain-foundation builder grants are ecosystem funding: they stay
    // in Crypto. Grants is real grants only (government, industry,
    // foundations, universities).
    if (CHAIN_FUNDER_RE.test(deal.title)) {
      return { ...base, track: "crypto" };
    }
    return { ...base, track: "grants", grantKind: grantKindFor(deal) };
  }

  return { ...base, track: deal.track as DisplayTrack };
}

/* ------------------------------------------------------------------ */
/* Dedupe                                                               */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "in", "on", "at", "to",
  "with", "by", "from", "up", "no", "per", "via", "x", "&",
]);

/** Words that describe an offer, not which opportunity it is. */
const FILLER = new Set([
  "free", "fully", "funded", "funding", "scholarship", "scholarships",
  "scholar", "scholars", "program", "programs", "programme", "programmes",
  "student", "students", "api", "nigeria", "nigerian", "global",
  "worldwide", "remote", "online", "licence", "license", "lifetime",
  "official", "grant", "grants", "microgrant", "microgrants",
  "small", "giveaway", "renewable", "hr", "hrs",
]);

/**
 * Single-product brands whose listings differ only in their descriptor
 * ("Grey — Free USD account", "Grey — Free multi-currency account").
 * Keyed by the brand token at the start of the title.
 */
const BRAND_ALIASES: [RegExp, string][] = [
  [/^azure for students/i, "azure-students"],
  [/^oracle cloud/i, "oracle-cloud"],
  [/^google cloud free/i, "google-cloud-free"],
  [/^google gemini/i, "gemini-free"],
  [/^groqcloud/i, "groq-free"],
  [/^groq\b/i, "groq-free"],
  [/^openrouter/i, "openrouter-free"],
  [/^inception mercury/i, "inception-mercury"],
  [/^assemblyai/i, "assemblyai"],
  [/^jetbrains/i, "jetbrains-pack"],
  [/^notion/i, "notion-education"],
  [/^github student developer pack/i, "github-pack"],
  [/^divi pixel/i, "divi-pixel"],
  [/^aws free/i, "aws-free"],
  [/^mlh fellowship/i, "mlh-fellowship"],
  [/^erasmus mundus noha/i, "erasmus-noha"],
  [/^rarible/i, "rarible"],
  [/^mastercard foundation/i, "mc"],
  [/^grey\b/i, "bank-grey"],
  [/^payoneer/i, "bank-payoneer"],
  [/^wise\b/i, "bank-wise"],
  [/^cleva/i, "bank-cleva"],
  [/^astropay/i, "bank-astropay"],
  [/^fundall/i, "bank-fundall"],
  [/^chipper/i, "bank-chipper"],
  [/^getplu/i, "bank-getplu"],
  [/^worldfirst/i, "bank-worldfirst"],
];

function singularise(word: string): string {
  // Latin "-us" words (erasmus, mundus, campus, status) are not plurals.
  if (word.endsWith("us")) return word;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Significant tokens of a title fragment: lowercased, singular, sorted. */
function tokensOf(fragment: string): string[] {
  return fragment
    .toLowerCase()
    .replace(/programme/g, "program")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !/\d/.test(t)) // years, amounts, versions, "12-month"
    .map(singularise)
    .filter((t) => !STOPWORDS.has(t) && !FILLER.has(t));
}

/**
 * Canonical dedupe key for a deal title, or null when no key applies.
 * Uses the part before a " — " / " – " / " + " / " via " descriptor only
 * when that part still names the opportunity (2+ significant tokens);
 * otherwise the whole title is used, so short brand-first titles
 * ("Mercor — …") never collapse unrelated listings from the same brand.
 * A plain hyphen is NOT a descriptor cut: titles like "DAAD … - MSc
 * Electrical Power Systems, University of Rwanda" carry the distinguishing
 * detail after the hyphen.
 */
export function titleKey(title: string): string | null {
  const noParens = title.replace(/\([^)]*\)/g, " ");
  const cut = noParens.split(/\s+(?:—|–)\s+|\s*\+\s+|\s+via\s+/i)[0] ?? "";
  const cutTokens = tokensOf(cut);
  const source = cutTokens.length >= 2 ? cut : noParens;
  const tokens = [...new Set(tokensOf(source))].sort();
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}

/** Host/programme-specific aliases that a plain title key cannot catch. */
function aliasKey(title: string): string | null {
  const lower = title.toLowerCase();
  if (lower.includes("mastercard foundation")) {
    if (lower.includes("sciences po")) return "mc-sciences-po";
    if (lower.includes("cambridge")) return "mc-cambridge";
    if (lower.includes("asu") || lower.includes("arizona")) return "mc-asu";
    if (lower.includes("edinburgh")) return "mc-edinburgh";
    return "mc-other";
  }
  for (const [re, key] of BRAND_ALIASES) {
    if (re.test(title)) return key;
  }
  return null;
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return (
      u.hostname.replace(/^www\./, "") +
      u.pathname.replace(/\/$/, "")
    ).toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** All grouping keys for a deal: URL key, alias key, title key. */
function groupKeys(deal: Deal): string[] {
  const keys: string[] = [`url:${normalizeUrl(deal.sourceUrl)}`];
  const alias = aliasKey(deal.title);
  if (alias) keys.push(`alias:${alias}`);
  const tk = titleKey(deal.title);
  if (tk) keys.push(`title:${tk}`);
  return keys;
}

function completeness(deal: Deal): number {
  return (
    deal.requirements.length +
    deal.actionSteps.length +
    deal.estimatedValue.length
  );
}

/** Best entry of a duplicate group: verified, most complete, latest expiry. */
function bestOf(group: Deal[]): Deal {
  const score = (d: Deal) => {
    const dLeft = daysLeft(d);
    const expiryScore =
      dLeft === null ? 0.5 : Math.max(0, Math.min(dLeft, 365)) / 365;
    return (
      (d.verification === "verified" ? 3 : 0) +
      (d.valueUsd !== null ? 1 : 0) +
      expiryScore +
      completeness(d) / 2000 +
      d.id * 0.0001 // newest scan entry wins exact ties
    );
  };
  return [...group].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Collapse duplicate opportunities: one entry per group. Union-find over
 * the grouping keys, so a deal matching a group by URL and another by
 * title still lands in the same group.
 */
export function dedupeDeals(deals: Deal[]): Deal[] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    const p = parent.get(i) ?? i;
    if (p !== i) {
      const root = find(p);
      parent.set(i, root);
      return root;
    }
    return p;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const keyOwner = new Map<string, number>();
  deals.forEach((deal, i) => {
    parent.set(i, i);
    for (const key of groupKeys(deal)) {
      const owner = keyOwner.get(key);
      if (owner === undefined) keyOwner.set(key, i);
      else union(owner, i);
    }
  });

  const groups = new Map<number, Deal[]>();
  deals.forEach((deal, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(deal);
    groups.set(root, group);
  });

  return [...groups.values()].map(bestOf).sort((a, b) => a.id - b.id);
}

/** Full load path: dedupe first, then re-classify each kept deal. */
export function prepareDeals(deals: Deal[]): ResolvedDeal[] {
  return dedupeDeals(deals).map(resolveDeal);
}

/* ------------------------------------------------------------------ */
/* AI UniPod UNILAG curation                                           */
/* ------------------------------------------------------------------ */

/**
 * Keywords that mark an opportunity as relevant to AI UniPod UNILAG
 * members, matched against the deal's title, requirements and benefit
 * text. The list is deliberately narrow and transparent: it covers the
 * UniPod's work (robotics, making and fabrication, AI training) and the
 * kinds of support its members use (student cloud credits, hackathons,
 * builder grants). Nothing is invented — a deal matches only if the
 * feed's own text contains one of these terms.
 */
export const UNIPOD_KEYWORDS: string[] = [
  "robotics",
  "robot",
  "maker",
  "makerspace",
  "hardware",
  "3d print",
  "laser cut",
  "ai training",
  "machine learning",
  "artificial intelligence",
  "student cloud",
  "hackathon",
  "builder grant",
  "embedded",
  "arduino",
  "esp32",
  "prototyping",
  "fabrication",
  "computer vision",
];

export function matchesUniPod(
  deal: Pick<Deal, "title" | "requirements" | "estimatedValue" | "eligibility">,
): boolean {
  const hay =
    `${deal.title} ${deal.requirements} ${deal.estimatedValue} ${deal.eligibility}`.toLowerCase();
  return UNIPOD_KEYWORDS.some((k) => hay.includes(k));
}
