import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ALL_DEALS, type Deal } from "@/lib/deals";
import { FEED_URL } from "@/lib/feed";
import { prepareDeals } from "@/lib/classify";
import {
  appendMissingFieldRoles,
  appendMissingOpenScholarships,
  buildBroadSnapshot,
  buildJudgmentSnapshot,
  buildSnapshot,
  countsSummary,
  fieldSectionDeals,
  isBroadQuestion,
  isGoodModelReply,
  isJudgmentQuestion,
  JUDGMENT_OPEN_FIELD_INSTRUCTION,
  openSectionDeals,
  rankDeals,
  rankJudgmentShortlist,
  todayLine,
  tryDeterministic,
} from "@/lib/scout-answer";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const PRIMARY_MODEL = "google/gemma-4-31b-it:free";
const FALLBACK_MODEL = "baidu/ernie-5.5-flash-preview:free";
const SNAPSHOT_MAX_CHARS = 8000;
const MAX_TOKENS_BROAD = 400;
const MAX_TOKENS_DETAIL = 1500;
const FETCH_TIMEOUT_MS = 9000;
// Vercel Hobby functions stop around 10s, so the whole attempt chain
// must fit inside this budget, with a little headroom for the reply.
const FUNCTION_BUDGET_MS = 9500;

interface IncomingMessage {
  role?: unknown;
  content?: unknown;
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

/** Gemini needs alternating user/model turns, so merge any consecutive
 *  same-role messages into one. The last message is always a user one. */
function toGeminiContents(
  messages: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "model"; parts: { text: string }[] }[] {
  const out: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n${m.content}`;
    } else {
      out.push({ role, parts: [{ text: m.content }] });
    }
  }
  return out;
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  timeoutMs: number,
  maxTokens: number,
  raceSignal?: AbortSignal,
): Promise<CallResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (raceSignal) {
    // Losing the race aborts this attempt; the listener keeps the
    // controller as the single signal the fetch watches.
    if (raceSignal.aborted) controller.abort();
    else raceSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const started = Date.now();
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let snippet = text.slice(0, 200);
      try {
        const err = JSON.parse(text) as { error?: { message?: unknown } };
        if (typeof err?.error?.message === "string") {
          snippet = err.error.message.slice(0, 200);
        }
      } catch {
        // Keep the raw snippet.
      }
      return {
        ok: false,
        status: res.status,
        errorSnippet: snippet,
        aborted: false,
        elapsedMs,
        model: GEMINI_MODEL,
      };
    }
    const data: unknown = await res.json();
    const finishReason =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { candidates?: unknown }).candidates) &&
      (data as { candidates: { finishReason?: unknown }[] }).candidates[0]
        ?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      console.warn(
        "[ask-scout] gemini reply cut off by output token cap",
        JSON.stringify({ model: GEMINI_MODEL, maxTokens }),
      );
    }
    const parts =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { candidates?: unknown }).candidates) &&
      (data as { candidates: { content?: { parts?: { text?: unknown }[] } }[] })
        .candidates[0]?.content?.parts;
    const reply = Array.isArray(parts)
      ? parts
          .map((p) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
          .trim()
      : "";
    if (reply.length === 0) {
      return {
        ok: false,
        status: res.status,
        errorSnippet: "empty reply",
        aborted: false,
        elapsedMs,
        model: GEMINI_MODEL,
      };
    }
    return { ok: true, reply, status: res.status, errorSnippet: "", aborted: false, elapsedMs, model: GEMINI_MODEL };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorSnippet: controller.signal.aborted
        ? raceSignal?.aborted && !timedOut
          ? "aborted (race lost)"
          : "aborted (timeout)"
        : String(err).slice(0, 200),
      aborted: controller.signal.aborted,
      elapsedMs: Date.now() - started,
      model: GEMINI_MODEL,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  timeoutMs: number,
  maxTokens: number,
  raceSignal?: AbortSignal,
): Promise<CallResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (raceSignal) {
    if (raceSignal.aborted) controller.abort();
    else raceSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
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
        max_tokens: maxTokens,
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
        ? raceSignal?.aborted && !timedOut
          ? "aborted (race lost)"
          : "aborted (timeout)"
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
    .slice(-6);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Send a message to ask Scout." },
      { status: 400 },
    );
  }

  const question = messages[messages.length - 1].content;
  const questionLog = question.slice(0, 80);
  // Same list the site displays: dedupe and re-classify first, so the
  // counts, ranking and snapshot all describe the same opportunities.
  const deals = prepareDeals(await loadDeals());

  // Deterministic first: if the listings themselves answer the question,
  // answer from the data with no model call at all, so it cannot fail
  // with "Scout could not answer right now".
  const deterministic = tryDeterministic(deals, question);
  if (deterministic) {
    console.log(
      "[ask-scout] answered",
      JSON.stringify({
        path: `deterministic:${deterministic.type}`,
        question: questionLog,
      }),
    );
    return NextResponse.json({ reply: deterministic.reply });
  }

  // Only the model path needs API keys; the deterministic path above
  // already answered without them.
  const geminiKey = process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!geminiKey && !openRouterKey) {
    return NextResponse.json(
      { error: "The chatbot is not configured yet. Try again later." },
      { status: 503 },
    );
  }
  const broad = isBroadQuestion(deals, question);
  // Judgment questions use the smarter shortlist (field expansion plus
  // open-to-all), not the plain keyword ranking, and never the broad
  // one-example-per-track snapshot: the model can only judge what it
  // is shown.
  const judgment = isJudgmentQuestion(question);
  const ranked = judgment
    ? rankJudgmentShortlist(deals, question)
    : broad
      ? []
      : rankDeals(deals, question);

  const systemIntro = [
    "You are Scout, the assistant for Alpha Scout, a site that lists free opportunities open to Nigeria: scholarships, grants, hackathons, competitions, remote jobs and free tools.",
    todayLine(),
    "Use that date when judging what is closing soon or already closed. Do not guess the date.",
    "Answer only from the opportunity list below. Summarize opportunities and brief the user on requirements, eligibility, deadlines, action steps and the official source.",
  ];
  const systemSpecific = [
    ...systemIntro,
    "When the user asks about the whole list, use the counts line above the list to report the totals, and summarize by category instead of listing every item one by one. The list below is only a sample of the full list, ranked for this question.",
    ...(judgment
      ? [
          "The shortlist below is split into two sections: 'Field-specific fits' and 'Open to all disciplines, any graduate can apply'. Judge only what is shown. Do not claim a listing is absent or a field is uncovered when it is not in the shortlist; if the shortlist does not cover the question, say so and suggest checking the site.",
          JUDGMENT_OPEN_FIELD_INSTRUCTION,
        ]
      : [
          "The ranked sample below is drawn from the same list the counts describe, and earlier answers in this conversation came from that same list, so do not retract or second-guess them when the sample shows only part of the list.",
        ]),
    "Never invent details, values or deadlines. If the list does not contain the answer, say so plainly and suggest checking the official source.",
    "Always include the official source link for any opportunity you mention.",
    "Keep every answer under 250 words. List at most 5 opportunities, one short line each, with the official source link. No long paragraphs.",
    "Opportunities:",
  ].join("\n");
  const systemBroad = [
    ...systemIntro,
    `There are ${deals.length} opportunities in total (counts below). The entries below are ONE EXAMPLE per category, not the whole list. Use the counts for any totals. Never say a category is absent when its count is above zero, and never describe the sample as the whole list.`,
    "If an earlier answer in this conversation disagrees with the counts line above, the counts line is correct.",
    "Summarize by category using the counts. Do not list every item one by one, and do not go into detail on the example entries.",
    "Never invent details, values or deadlines. If the list does not contain the answer, say so plainly and suggest checking the official source.",
    "The example entries below have no source links, so do not invent any. Only mention a source link when it is shown in the list.",
    "Keep every answer under 250 words. List at most 5 opportunities, one short line each, with the official source link. No long paragraphs.",
    "Opportunities:",
  ].join("\n");
  // Judgment questions get a slimmer snapshot (eligibility and
  // requirements trimmed) so more of the shortlist fits in view: the
  // model needs breadth, the right candidates, more than full text.
  const buildPrompt = (maxChars: number) => {
    if (broad && !judgment) {
      return `${systemBroad}\n${countsSummary(deals)}\n${buildBroadSnapshot(deals)}`;
    }
    const snapshot = judgment
      ? buildJudgmentSnapshot(ranked, maxChars)
      : buildSnapshot(ranked, maxChars);
    return `${systemSpecific}\n${countsSummary(deals)}\n${snapshot}`;
  };

  const fail = () =>
    NextResponse.json(
      { error: "Scout could not answer right now. Try again." },
      { status: 502 },
    );

  // Race: all three providers start at the same time, each with the
  // same 8,000-char snapshot, and the first GOOD answer wins. A
  // smaller snapshot for Gemma and Ernie let Ernie win by being
  // fastest while seeing almost none of the shortlist, so first-to-
  // answer no longer wins on its own: a reply that is too short,
  // ends mid-sentence or names no source link is rejected and the
  // race continues to the next finisher. Waiting serially burned the
  // whole budget on one slow attempt (Gemini timing out at 9s while
  // OpenRouter 429ed), so nothing was left for a fallback.
  const chainStarted = Date.now();
  // Broad answers are short (counts plus one line per category), so a
  // small token cap keeps them fast enough to finish inside the timeout.
  // Detail answers list items with links, so they get a larger cap.
  // Judgment questions always get the detail cap, even when the
  // question looks broad, so the model has room to judge the shortlist.
  const maxTokens = broad && !judgment ? MAX_TOKENS_BROAD : MAX_TOKENS_DETAIL;
  const logFailure = (label: string, r: CallResult) => {
    console.error(
      `[ask-scout] ${label} failed`,
      JSON.stringify({
        model: r.model,
        status: r.status,
        aborted: r.aborted,
        elapsedMs: r.elapsedMs,
        error: r.errorSnippet,
        question: questionLog,
      }),
    );
  };
  // Time left for a new attempt, keeping headroom inside the budget.
  const attemptTimeout = () =>
    Math.min(FETCH_TIMEOUT_MS, FUNCTION_BUDGET_MS - (Date.now() - chainStarted) - 500);

  const raceController = new AbortController();
  const raceTimeoutMs = attemptTimeout();
  const racers: Promise<CallResult>[] = [];
  if (geminiKey) {
    racers.push(
      callGemini(
        geminiKey,
        buildPrompt(SNAPSHOT_MAX_CHARS),
        messages,
        raceTimeoutMs,
        maxTokens,
        raceController.signal,
      ),
    );
  }
  if (openRouterKey) {
    racers.push(
      callOpenRouter(
        openRouterKey,
        PRIMARY_MODEL,
        buildPrompt(SNAPSHOT_MAX_CHARS),
        messages,
        raceTimeoutMs,
        maxTokens,
        raceController.signal,
      ),
    );
    racers.push(
      callOpenRouter(
        openRouterKey,
        FALLBACK_MODEL,
        buildPrompt(SNAPSHOT_MAX_CHARS),
        messages,
        raceTimeoutMs,
        maxTokens,
        raceController.signal,
      ),
    );
  }

  const settled: CallResult[] = [];
  let remaining = racers.length;
  const winner = await new Promise<CallResult | undefined>((resolve) => {
    if (racers.length === 0) return resolve(undefined);
    for (const p of racers) {
      p.then((r) => {
        settled.push(r);
        if (r.ok && r.reply) {
          // First GOOD answer wins. A reply that fails the quality
          // gate does not win; the race continues to the next
          // finisher, and the rejection is logged with the reason.
          const gate = isGoodModelReply(r.reply);
          if (gate.ok) {
            raceController.abort();
            resolve(r);
          } else {
            console.error(
              "[ask-scout] model reply rejected",
              JSON.stringify({
                model: r.model,
                reason: gate.reason,
                question: questionLog,
                reply: r.reply.slice(0, 200),
              }),
            );
            remaining -= 1;
            if (remaining === 0) resolve(undefined);
          }
        } else {
          remaining -= 1;
          if (remaining === 0) resolve(undefined);
        }
      }).catch(() => {
        remaining -= 1;
        if (remaining === 0) resolve(undefined);
      });
    }
  });
  if (winner?.reply) {
    let finalReply = winner.reply;
    let appended = 0;
    let appendedField = 0;
    if (judgment) {
      // Deterministic guarantee: the strongest any-discipline
      // scholarships are appended when the model fails to name them,
      // so they can never be dropped by the model's choice.
      const augmented = appendMissingOpenScholarships(
        winner.reply,
        openSectionDeals(ranked),
      );
      // Same guarantee for field-specific roles: the model dropped
      // the strongest physics fit in run 14 (Atomistic Materials
      // Modeling Expert) while naming a generic STEM role instead.
      const fieldAugmented = appendMissingFieldRoles(
        augmented.reply,
        fieldSectionDeals(ranked),
      );
      finalReply = fieldAugmented.reply;
      appended = augmented.appended;
      appendedField = fieldAugmented.appended;
    }
    console.log(
      "[ask-scout] answered",
      JSON.stringify({
        path: `model:${winner.model}`,
        question: questionLog,
        ...(judgment
          ? { appendedScholarships: appended, appendedFieldRoles: appendedField }
          : {}),
      }),
    );
    return NextResponse.json({ reply: finalReply });
  }
  for (const r of settled) {
    logFailure(r.model === GEMINI_MODEL ? "gemini" : "openrouter", r);
  }

  return fail();
}
