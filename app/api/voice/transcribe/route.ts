import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

// Deepgram speech-to-text, pre-recorded REST endpoint. Nova-3 is the
// general-purpose model for recorded audio; smart_format adds
// punctuation and number formatting. The API key stays server-side:
// the browser sends audio here, never to Deepgram directly.
const DEEPGRAM_LISTEN_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true";
// A spoken question is seconds long; 5 MB is far more than a minute
// of recorded audio and bounds what one call can spend.
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

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
  const contentType = req.headers.get("content-type") ?? "audio/webm";
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "That recording was too long. Keep it under a minute." },
      { status: 413 },
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(DEEPGRAM_LISTEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: audio,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "[ask-scout] deepgram listen failed",
        JSON.stringify({ status: res.status, error: text.slice(0, 200) }),
      );
      return NextResponse.json(
        { error: "Voice transcription failed. Try again." },
        { status: 502 },
      );
    }
    const data: unknown = await res.json();
    const transcript =
      data &&
      typeof data === "object" &&
      (data as {
        results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] };
      }).results?.channels?.[0]?.alternatives?.[0]?.transcript;
    return NextResponse.json({
      transcript: typeof transcript === "string" ? transcript.trim() : "",
    });
  } catch {
    return NextResponse.json(
      { error: "Voice transcription failed. Try again." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
