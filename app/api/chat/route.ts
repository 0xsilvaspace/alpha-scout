import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ALL_DEALS, type Deal } from "@/lib/deals";
import { FEED_URL } from "@/lib/feed";

const MODEL = "google/gemma-4-26b-a4b-it:free";
const SNAPSHOT_MAX_CHARS = 25000;

interface IncomingMessage {
  role?: unknown;
  content?: unknown;
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

  const deals = await loadDeals();
  let snapshot = JSON.stringify(deals.map(compactDeal));
  if (snapshot.length > SNAPSHOT_MAX_CHARS) {
    snapshot =
      snapshot.slice(0, SNAPSHOT_MAX_CHARS) +
      " ... (list cut short, newest entries kept first is not guaranteed)";
  }

  const systemPrompt = [
    "You are Scout, the assistant for Alpha Scout, a site that lists free opportunities open to Nigeria: scholarships, grants, hackathons, competitions, remote jobs and free tools.",
    "Answer only from the opportunity list below. Summarize opportunities and brief the user on requirements, eligibility, deadlines, action steps and the official source.",
    "Never invent details, values or deadlines. If the list does not contain the answer, say so plainly and suggest checking the official source.",
    "Always include the official source link for any opportunity you mention.",
    "Keep answers short and plain.",
    "Opportunities:",
    snapshot,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Scout could not answer right now. Try again." },
        { status: 502 },
      );
    }
    const data: unknown = await res.json();
    const reply =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { choices?: unknown }).choices) &&
      (data as { choices: { message?: { content?: unknown } }[] }).choices[0]
        ?.message?.content;
    if (typeof reply !== "string" || reply.trim().length === 0) {
      return NextResponse.json(
        { error: "Scout could not answer right now. Try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ reply: reply.trim() });
  } catch {
    return NextResponse.json(
      { error: "Scout could not answer right now. Try again." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
