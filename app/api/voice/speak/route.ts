import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { stripForSpeech } from "@/lib/voice";

// Deepgram text-to-speech, REST endpoint. Aura-2 Thalia is the
// default English voice. The API key stays server-side: the browser
// sends text here and gets audio back, never to Deepgram directly.
const DEEPGRAM_SPEAK_URL =
  "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en";

export async function POST(req: Request) {
  // Signed-in users only, same as /api/chat.
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
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice is not set up yet. Add DEEPGRAM_API_KEY in Vercel." },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Send text to speak." },
      { status: 400 },
    );
  }
  const raw =
    body &&
    typeof body === "object" &&
    typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text
      : "";
  const text = stripForSpeech(raw);
  if (!text) {
    return NextResponse.json(
      { error: "Nothing to speak." },
      { status: 400 },
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(DEEPGRAM_SPEAK_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(
        "[ask-scout] deepgram speak failed",
        JSON.stringify({ status: res.status, error: errText.slice(0, 200) }),
      );
      return NextResponse.json(
        { error: "Could not play that reply. Try again." },
        { status: 502 },
      );
    }
    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not play that reply. Try again." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
