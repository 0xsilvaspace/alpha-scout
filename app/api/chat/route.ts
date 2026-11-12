import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ALL_DEALS, daysLeft, type Deal } from "@/lib/deals";
import { FEED_URL } from "@/lib/feed";

const PRIMARY_MODEL = "google/gemma-4-31b-it:free";
const FALLBACK_MODEL = "baidu/ernie-5.5-flash-preview:free";
const SNAPSHOT_MAX_CHARS = 8000;
const SNAPSHOT_RETRY_CHARS = 4000;
const MAX_TOKENS = 900;
const FETCH_TIMEOUT_MS = 9000;

interface IncomingMessage {
  role?: unknown;
  content?: unknown;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "what", "which", "that", "this", "are",
  "there", "here", "have", "has", "from", "about", "when", "where",
  "list", "show", "give", "tell", "please", "open", "free", "any",
  "all", "can", "you", "your", "our", "out", "into", "more", "some",
  "does", "like", "need", "want", "get", "also", "still", "available",
]);

const DEADLINE_WORDS = /\b(deadline|deadlines|closing|closes|close|expir|expires|expiry|due|soon|running out|last date)\b/i;

// Track words a question may use, mapped to the deal track they mean.
const TRACK_WORDS: Record<string, string[]> = {
  scholarships: ["scholarship", "scholarships", "masters", "phd", "study"],
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

function scoreDeal(d: Deal, tokens: string[]): number {
  const haystack = `${d.title} ${d.track} ${d.eligibility} ${d.requirements}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (wordForms(t).some((f) => haystack.includes(f))) score += 1;
    if (d.title.toLowerCase().includes(t)) score += 1;
  }
  for (const [track, words] of Object.entries(TRACK_WORDS)) {
    if (d.track === track && words.some((w) => tokens.includes(w))) score += 2;
  }
  return score;
}

function isClosingSoon(d: Deal): boolean {
  const left = daysLeft(d);
  return left !== null && left >= 0 && left <= 14;
}

/** Deals ordered for this question: deadline deals first when the user
 *  asks about deadlines, then best keyword matches, then soonest expiry. */
function rankDeals(deals: Deal[], question: string): Deal[] {
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
  const ordered: Deal[] = [];
  const push = (d: Deal) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      ordered.push(d);
    }
  };
  if (deadlineAsked) closing.forEach(push);
  matched.forEach(push);
  if (matched.length === 0 && !deadlineAsked) {
    // Broad question (e.g. "what is listed"): a spread across tracks.
    const byTrack = new Map<string, Deal[]>();
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

function compactDeal(d: Deal) {
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
function todayLine(): string {
  const now = new Date();
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", ...opts }).format(now);
  return `Today is ${fmt({ weekday: "long" })} ${fmt({ day: "numeric" })} ${fmt({ month: "long" })} ${fmt({ year: "numeric" })}.`;
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

function countsSummary(deals: Deal[]): string {
  const counts = new Map<string, number>();
  for (const d of deals) {
    counts.set(d.track, (counts.get(d.track) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([track, n]) => `${n} ${TRACK_LABELS[track] ?? track}`);
  return `The full list has ${deals.length} opportunities: ${parts.join(", ")}.`;
}

/** Snapshot of the ranked deals, cut at maxChars without breaking a deal. */
function buildSnapshot(ranked: Deal[], maxChars: number): string {
  const parts: string[] = ["["];
  let length = 1;
  for (const d of ranked) {
    const piece = JSON.stringify(compactDeal(d));
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

async function loadDeals(): Promise<Deal[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(FEED_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return ALL_DEALS;
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return ALL_DEALS;
    const deals = (json as { deals?: unknown }).deals;
    if (!Array.isArray(deals) || deals.length === 0) return ALL_DEALS;
    return deals as Deal[];
  } catch {
    return ALL_DEALS;
  } finally {
    clearTimeout(timer);
  }
}

interface CallResult {
  ok: boolean;
  reply?: string;
  status: number;
  errorSnippet: string;
  aborted: boolean;
  elapsedMs: number;
  model: string;
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        errorSnippet: text.slice(0, 200),
        aborted: false,
        elapsedMs,
        model,
      };
    }
    const data: unknown = await res.json();
    const reply =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { choices?: unknown }).choices) &&
      (data as { choices: { message?: { content?: unknown } }[] }).choices[0]
        ?.message?.content;
    if (typeof reply !== "string" || reply.trim().length === 0) {
      return {
        ok: false,
        status: res.status,
        errorSnippet: "empty reply",
        aborted: false,
        elapsedMs,
        model,
      };
    }
    return { ok: true, reply: reply.trim(), status: res.status, errorSnippet: "", aborted: false, elapsedMs, model };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorSnippet: controller.signal.aborted
        ? "aborted (timeout)"
        : String(err).slice(0, 200),
      aborted: controller.signal.aborted,
      elapsedMs: Date.now() - started,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  // Signed-in users only.
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Sign in is not set up yet. Try again later." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to ask Scout." },
      { status: 401 },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The chatbot is not configured yet. Try again later." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Send a message to ask Scout." },
      { status: 400 },
    );
  }
  const incoming =
    body && typeof body === "object" && Array.isArray((body as { messages?: unknown }).messages)
      ? ((body as { messages: IncomingMessage[] }).messages as IncomingMessage[])
      : [];
  const messages = incoming
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as string).slice(0, 500),
    }))
    .slice(-10);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Send a message to ask Scout." },
      { status: 400 },
    );
  }

  const question = messages[messages.length - 1].content;
  const questionLog = question.slice(0, 80);
  const deals = await loadDeals();
  const ranked = rankDeals(deals, question);

  const systemBase = [
    "You are Scout, the assistant for Alpha Scout, a site that lists free opportunities open to Nigeria: scholarships, grants, hackathons, competitions, remote jobs and free tools.",
    todayLine(),
    "Use that date when judging what is closing soon or already closed. Do not guess the date.",
    "Answer only from the opportunity list below. Summarize opportunities and brief the user on requirements, eligibility, deadlines, action steps and the official source.",
    "When the user asks about the whole list, use the counts line above the list to report the totals, and summarize by category instead of listing every item one by one. The list below is only a sample of the full list, ranked for this question.",
    "Never invent details, values or deadlines. If the list does not contain the answer, say so plainly and suggest checking the official source.",
    "Always include the official source link for any opportunity you mention.",
    "Keep answers short and plain.",
    "Opportunities:",
  ].join("\n");
  const buildPrompt = (maxChars: number) =>
    `${systemBase}\n${countsSummary(deals)}\n${buildSnapshot(ranked, maxChars)}`;

  const fail = () =>
    NextResponse.json(
      { error: "Scout could not answer right now. Try again." },
      { status: 502 },
    );

  const first = await callOpenRouter(apiKey, PRIMARY_MODEL, buildPrompt(SNAPSHOT_MAX_CHARS), messages);
  if (first.ok && first.reply) {
    return NextResponse.json({ reply: first.reply });
  }
  console.error(
    "[ask-scout] openrouter failed",
    JSON.stringify({
      model: first.model,
      status: first.status,
      aborted: first.aborted,
      elapsedMs: first.elapsedMs,
      error: first.errorSnippet,
      question: questionLog,
    }),
  );

  // One retry with the fallback model and a smaller snapshot, on rate
  // limiting, a server error, a timeout, a failed fetch or an empty reply.
  const retriable =
    first.status === 429 ||
    first.status >= 500 ||
    first.status === 0 ||
    first.aborted ||
    first.errorSnippet === "empty reply";
  if (retriable) {
    const second = await callOpenRouter(apiKey, FALLBACK_MODEL, buildPrompt(SNAPSHOT_RETRY_CHARS), messages);
    if (second.ok && second.reply) {
      return NextResponse.json({ reply: second.reply });
    }
    console.error(
      "[ask-scout] openrouter retry failed",
      JSON.stringify({
        model: second.model,
        status: second.status,
        aborted: second.aborted,
        elapsedMs: second.elapsedMs,
        error: second.errorSnippet,
        question: questionLog,
      }),
    );
  }

  return fail();
}
