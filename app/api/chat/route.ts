import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ALL_DEALS, type Deal } from "@/lib/deals";
import { FEED_URL } from "@/lib/feed";
import { prepareDeals } from "@/lib/classify";
import {
  appendMissingDirectFits,
  appendMissingFieldRoles,
  appendMissingOpenScholarships,
  buildBroadSnapshot,
  buildFitSnapshot,
  buildJudgmentSnapshot,
  buildSnapshot,
  countsSummary,
  detectFieldOfStudy,
  detectQuestionTrack,
  fieldSectionDeals,
  fitCountsLine,
  fitTier,
  isBroadQuestion,
  isFitQuestion,
  isGoodModelReply,
  isJudgmentQuestion,
  JUDGMENT_OPEN_FIELD_INSTRUCTION,
  openSectionDeals,
  rankDeals,
  rankFitShortlist,
  rankJudgmentShortlist,
  requestedCount,
  todayLine,
  TRACK_LABELS,
  trimToCount,
  tryDeterministic,
  tryShowMore,
} from "@/lib/scout-answer";
import {
  availableProviders,
  CEREBRAS_MODEL,
  CEREBRAS_URL,
  OPENAI_MODEL,
  OPENAI_URL,
  openRouterFallbackOrder,
  pickOpenRouterModel,
  type OpenRouterFreeModel,
  type ProviderName,
} from "@/lib/model-racers";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
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
  provider: ProviderName;
  // Provider finish reason, when the response carries one: Gemini
  // "MAX_TOKENS", OpenRouter "length" mean the reply was cut by the
  // output token cap. The gate rejects those (see isGoodModelReply).
  finishReason?: string;
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
  fallbackApiKey: string | undefined,
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
  // A second Gemini key only helps when it comes from a different
  // Google Cloud project (quotas are per project, not per key), so
  // it is tried only when the first key is rate-limited.
  const keys =
    fallbackApiKey && fallbackApiKey !== apiKey ? [apiKey, fallbackApiKey] : [apiKey];
  try {
    for (let ki = 0; ki < keys.length; ki++) {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": keys[ki],
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
        if (res.status === 429 && ki + 1 < keys.length) {
          console.warn(
            "[ask-scout] gemini key rate-limited, trying second key",
            JSON.stringify({ status: res.status }),
          );
          continue;
        }
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
          provider: "gemini",
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
          provider: "gemini",
        };
      }
      return { ok: true, reply, status: res.status, errorSnippet: "", aborted: false, elapsedMs, model: GEMINI_MODEL, provider: "gemini", finishReason: typeof finishReason === "string" ? finishReason : undefined };
    }
    // Unreachable: keys always has at least one entry.
    return {
      ok: false,
      status: 0,
      errorSnippet: "no gemini key tried",
      aborted: false,
      elapsedMs: Date.now() - started,
      model: GEMINI_MODEL,
      provider: "gemini",
    };
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
      provider: "gemini",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One call to any OpenAI-compatible chat API (OpenRouter, Cerebras,
 *  OpenAI): same request shape, different base URL, key and model. */
async function callChatCompletions(
  provider: ProviderName,
  baseUrl: string,
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
    const res = await fetch(baseUrl, {
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
        provider,
      };
    }
    const data: unknown = await res.json();
    // These APIs report a token-cap cut as finish_reason "length";
    // without this the reply would look complete to the gate.
    const finishReason =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { choices?: unknown }).choices) &&
      (data as { choices: { finish_reason?: unknown }[] }).choices[0]
        ?.finish_reason;
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
        provider,
      };
    }
    return { ok: true, reply: reply.trim(), status: res.status, errorSnippet: "", aborted: false, elapsedMs, model, provider, finishReason: typeof finishReason === "string" ? finishReason : undefined };
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
      provider,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The OpenRouter racer: one picked free model per question, with one
 *  sequential fallback to the next model in the rotation when the pick
 *  fails (a retired free model 404s, a 429, a timeout). The fallback
 *  only fires on failure, so a normal question costs one OpenRouter
 *  request, not two, which is what doubled the daily budget. */
async function callOpenRouterWithFallback(
  apiKey: string,
  firstModel: OpenRouterFreeModel,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  timeoutMs: number,
  maxTokens: number,
  raceSignal?: AbortSignal,
): Promise<CallResult> {
  const started = Date.now();
  const models = [firstModel, ...openRouterFallbackOrder(firstModel)].slice(0, 2);
  let last: CallResult | undefined;
  for (const model of models) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 500) break;
    const r = await callChatCompletions(
      "openrouter",
      "https://openrouter.ai/api/v1/chat/completions",
      apiKey,
      model,
      systemPrompt,
      messages,
      remaining,
      maxTokens,
      raceSignal,
    );
    if (r.ok) return r;
    last = r;
    // A lost race aborts the attempt; there is nothing to fall back to.
    if (raceSignal?.aborted) return r;
  }
  return (
    last ?? {
      ok: false,
      status: 0,
      errorSnippet: "no openrouter model tried",
      aborted: false,
      elapsedMs: Date.now() - started,
      model: firstModel,
      provider: "openrouter",
    }
  );
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

  // A follow-up asking for more lists the next deals from the same
  // shortlist the previous answer drew from, never repeats the ones
  // already shown. It needs the full previous reply to know what was
  // shown: the model history above is sliced to 500 chars per message,
  // so this uses the incoming messages unsliced.
  const fullMessages = incoming
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }))
    .slice(-6);
  const showMore = tryShowMore(deals, fullMessages);
  if (showMore) {
    console.log(
      "[ask-scout] answered",
      JSON.stringify({
        path: `deterministic:${showMore.type}`,
        question: questionLog,
      }),
    );
    return NextResponse.json({ reply: showMore.reply });
  }

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
  // already answered without them. Providers join the race only when
  // their key is set in Vercel (see lib/model-racers).
  // When the user asked for a specific number ("top 3"), the model
  // lists exactly that many: the prompt says so, the guarantee
  // appends are skipped (they would push the total past the count),
  // and the reply is trimmed to the count deterministically.
  const count = requestedCount(question);
  const providers = availableProviders({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_API_KEY_2: process.env.GEMINI_API_KEY_2,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (providers.length === 0) {
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
  // The kind of opportunity the user asked about, if they named one:
  // the shortlist, the instruction and the guarantees all stay inside
  // it, so a jobs question is never answered with scholarships.
  const askedTrack = detectQuestionTrack(question);
  // Fit questions ("jobs a physics student can apply for") use the
  // strict fit shortlist, not the judgment one: only listings whose
  // own text makes them a fit for the named field, tiered, with
  // senior roles and umbrella boards out. A "my field" question with
  // no field named falls back to the judgment shortlist.
  const fitField = isFitQuestion(question)
    ? detectFieldOfStudy(question)
    : null;
  const fitShortlist =
    fitField !== null ? rankFitShortlist(deals, question) : null;
  const fit = fitShortlist !== null;
  const ranked = fit
    ? fitShortlist.all
    : judgment
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
  const listLine = count
    ? `Format every answer like this: one short opening line, then a numbered list of exactly ${count} opportunities. Number each item (1., 2., 3., ...) and put a blank line before each number, so the items are clearly separated. Each item is four lines: the title on its own line in **bold**, one short line saying what it offers, one line with the closing date (for example 'Closes 16 November 2026 (in 3 days)'), then the official source link on its own line as [Official source](url). Never put the closing date inside the description sentence, never print a raw URL, and never use bold anywhere except the title line. Keep every answer under 250 words.`
    : "Format every answer like this: one short opening line, then a numbered list of at most 5 opportunities. Number each item (1., 2., 3., ...) and put a blank line before each number, so the items are clearly separated. Each item is four lines: the title on its own line in **bold**, one short line saying what it offers, one line with the closing date (for example 'Closes 16 November 2026 (in 3 days)'), then the official source link on its own line as [Official source](url). Never put the closing date inside the description sentence, never print a raw URL, and never use bold anywhere except the title line. Keep every answer under 250 words.";
  const systemSpecific = [
    ...systemIntro,
    "When the user asks about the whole list, use the counts line above the list to report the totals, and summarize by category instead of listing every item one by one. The list below is only a sample of the full list, ranked for this question.",
    ...(judgment
      ? [
          "The shortlist below is split into two sections: 'Field-specific fits' and 'Open to all disciplines, any graduate can apply'. Judge only what is shown. Do not claim a listing is absent or a field is uncovered when it is not in the shortlist; if the shortlist does not cover the question, say so and suggest checking the site.",
          ...(askedTrack === null || askedTrack === "scholarships"
            ? [JUDGMENT_OPEN_FIELD_INSTRUCTION]
            : [
                `The user asked about ${TRACK_LABELS[askedTrack] ?? askedTrack} only. Recommend only ${TRACK_LABELS[askedTrack] ?? askedTrack} from the shortlist. Do not name scholarships, grants or any other kind of opportunity, even if they are strong fits in general.`,
              ]),
        ]
      : [
          "The ranked sample below is drawn from the same list the counts describe, and earlier answers in this conversation came from that same list, so do not retract or second-guess them when the sample shows only part of the list.",
        ]),
    "Never invent details, values or deadlines. If the list does not contain the answer, say so plainly and suggest checking the official source.",
    "Always include the official source link for any opportunity you mention.",
    listLine,
    "Opportunities:",
  ].join("\n");
  const systemBroad = [
    ...systemIntro,
    `There are ${deals.length} opportunities in total (counts below). The entries below are ONE EXAMPLE per category, not the whole list. Use the counts for any totals. Never say a category is absent when its count is above zero, and never describe the sample as the whole list.`,
    "If an earlier answer in this conversation disagrees with the counts line above, the counts line is correct.",
    "Summarize by category using the counts. Do not list every item one by one, and do not go into detail on the example entries.",
    "Never invent details, values or deadlines. If the list does not contain the answer, say so plainly and suggest checking the official source.",
    "The example entries below have no source links, so do not invent any. Only mention a source link when it is shown in the list.",
    "Keep every answer under 250 words. Write it as one short opening line, then a numbered list: number each item (1., 2., 3., ...) and put a blank line before each number, so the items are clearly separated. Each item is the title in **bold** on its own line, one short line saying what it offers, one line with the closing date, then the official source link on its own line as [Official source](url). Never print a raw URL, and never use bold anywhere except the title line.",
    "Opportunities:",
  ].join("\n");
  // Fit questions get their own prompt: answer the fit question
  // directly in prose first, list only the genuine fits, and never
  // pad to 5 or quote the site totals. The old prompt forced a
  // numbered list of up to 5 for every question and always prepended
  // the full-list counts, so a physics question came back as "48
  // remote jobs in total" with generic roles in it.
  const systemFit =
    fit && fitShortlist && fitField
      ? [
          ...systemIntro,
          `The user asked which opportunities a ${fitField} student or graduate can actually apply for. Answer that question directly, not the whole list.`,
          "The shortlist below is already filtered to genuine fits, split into labelled tiers: 'Directly for <field>', '<field>-adjacent' and (for scholarships and grants only) 'Open to all disciplines'. Each entry says why it fits and what level it needs.",
          "Start with one or two short sentences: how many directly-fitting opportunities there are, and the split between a current student and a graduate when the question asks about both. If the question asks about both a student and a graduate, say separately what each can apply for.",
          "Then list ONLY the fitting opportunities from the shortlist, in the order given. Never add a generic, senior or open-to-anyone role to reach 5 items: if only 1 or 2 fit, list only those. Never name an opportunity that is not in the shortlist.",
          "For each item, say in one line exactly why it fits, using the requirement in its entry (for example 'asks for a strong physics background' or 'lists physics among the eligible STEM fields'), and state its level bar (for example 'needs an MSc or PhD' or 'no degree level stated').",
          "If nothing in the shortlist fits, say so plainly in two or three sentences and do not invent or pad with other listings.",
          "Do NOT report the total number of opportunities on the site, and do NOT say how many jobs, scholarships or grants there are in total: that total is not the answer to this question.",
          "Never invent details, values or deadlines. Always include the official source link for any opportunity you mention.",
          "Format: one short opening (prose, not a list), then a numbered list of only the fits. Number each item (1., 2., ...) and put a blank line before each number. Each item is five lines: the title on its own line in **bold**, one short line saying what it offers, one line saying exactly why it fits, one line with the closing date (for example 'Closes 16 November 2026 (in 3 days)'), then the official source link on its own line as [Official source](url). Never put the closing date inside the description sentence, never print a raw URL, and never use bold anywhere except the title line. Keep every answer under 250 words.",
          "Opportunities:",
        ].join("\n")
      : "";
  // Judgment questions get a slimmer snapshot (eligibility and
  // requirements trimmed) so more of the shortlist fits in view: the
  // model needs breadth, the right candidates, more than full text.
  const buildPrompt = (maxChars: number) => {
    if (fit && fitShortlist && fitField) {
      // No counts line: the site totals are not the answer to a fit
      // question, and showing them invites the model to quote them.
      return `${systemFit}\n${fitCountsLine(fitShortlist)}\n${buildFitSnapshot(fitShortlist, maxChars)}`;
    }
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

  // Race: every configured provider starts at the same time, each
  // with the same 8,000-char snapshot, and the first GOOD answer
  // wins. A smaller snapshot for Gemma and Ernie let Ernie win by
  // being fastest while seeing almost none of the shortlist, so
  // first-to-answer no longer wins on its own: a reply that is too
  // short, was cut by the output token cap, ends inside a markdown
  // link, ends mid-sentence or names no source link is rejected and
  // the race continues to the next finisher. Waiting serially burned
  // the whole budget on one slow attempt (Gemini timing out at 9s
  // while OpenRouter 429ed), so nothing was left for a fallback.
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
  if (providers.includes("gemini")) {
    racers.push(
      callGemini(
        process.env.GEMINI_API_KEY as string,
        process.env.GEMINI_API_KEY_2,
        buildPrompt(SNAPSHOT_MAX_CHARS),
        messages,
        raceTimeoutMs,
        maxTokens,
        raceController.signal,
      ),
    );
  }
  if (providers.includes("openrouter")) {
    racers.push(
      callOpenRouterWithFallback(
        process.env.OPENROUTER_API_KEY as string,
        pickOpenRouterModel(question),
        buildPrompt(SNAPSHOT_MAX_CHARS),
        messages,
        raceTimeoutMs,
        maxTokens,
        raceController.signal,
      ),
    );
  }
  if (providers.includes("cerebras")) {
    racers.push(
      callChatCompletions(
        "cerebras",
        CEREBRAS_URL,
        process.env.CEREBRAS_API_KEY as string,
        CEREBRAS_MODEL,
        buildPrompt(SNAPSHOT_MAX_CHARS),
        messages,
        raceTimeoutMs,
        maxTokens,
        raceController.signal,
      ),
    );
  }
  if (providers.includes("openai")) {
    racers.push(
      callChatCompletions(
        "openai",
        OPENAI_URL,
        process.env.OPENAI_API_KEY as string,
        OPENAI_MODEL,
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
          // The gate sees the provider finish reason, so a reply cut
          // by the output token cap is rejected even when its text
          // looks complete.
          // A fit question with no fitting opportunity is answered
          // in plain prose with no source link to give, so the gate
          // is relaxed for it; every other answer still needs one.
          const gate = isGoodModelReply(
            r.reply,
            r.finishReason,
            fit ? { requireLink: false, minLength: 80 } : undefined,
          );
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
    // A count request skips the guarantees: appending up to 3
    // scholarships and up to 3 field roles after a "top 3" answer
    // would hand back 9 items for a question that asked for 3.
    if (judgment && !count) {
      if (fit && fitShortlist && fitField) {
        // Fit guarantee, tier 1 only: append a directly-fitting deal
        // the model failed to name. Adjacent and open deals are never
        // appended here: padding is what made the old answers wrong.
        // Scholarships keep the flagship open-scholarship guarantee
        // as well, because for a graduate those ARE genuine fits,
        // not padding.
        const direct = appendMissingDirectFits(
          winner.reply,
          fitShortlist.all.filter((d) => fitTier(d, fitField) === 1),
          fitField,
        );
        let replyAfter = direct.reply;
        let appendedSchol = 0;
        if (askedTrack === null || askedTrack === "scholarships") {
          const augmented = appendMissingOpenScholarships(
            replyAfter,
            openSectionDeals(ranked),
          );
          replyAfter = augmented.reply;
          appendedSchol = augmented.appended;
        }
        finalReply = replyAfter;
        appended = appendedSchol;
        appendedField = direct.appended;
      } else {
        // Deterministic guarantee: the strongest any-discipline
        // scholarships are appended when the model fails to name them,
        // so they can never be dropped by the model's choice. It only
        // runs when the user did not ask for a different kind: for a
        // jobs question it would append scholarships the user never
        // asked about.
        const augmented =
          askedTrack === null || askedTrack === "scholarships"
            ? appendMissingOpenScholarships(
                winner.reply,
                openSectionDeals(ranked),
              )
            : { reply: winner.reply, appended: 0 };
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
    }
    // The model is told "exactly N", but it sometimes lists more
    // anyway: trim the reply to exactly N items, deterministically.
    if (count) finalReply = trimToCount(finalReply, count);
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
    logFailure(r.provider, r);
  }

  return fail();
}
