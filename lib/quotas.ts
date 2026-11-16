import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user Ask Scout quotas (added 2026-11-15): the site must serve
// 500 visitors a day without the model and voice budgets running dry.
// Model questions: 5 per signed-in user per day, at most 1 a minute.
// Deterministic answers (list lookups, fit shortlists, show-more) use
// no model call and are never counted. Listen: 3 plays a day per user.
// Mic transcription: 5 a day per user. Days run on Africa/Lagos time.
// Counts live in public.ask_scout_usage (one row per user per day),
// enforced here server-side; RLS lets a user touch only their own rows.
// If the table is missing or Supabase errors, the check fails OPEN
// (allows the request) so Ask Scout never breaks on a quota outage.

export const MODEL_QUESTIONS_PER_DAY = 5;
export const MODEL_QUESTION_MIN_SECONDS = 60;
export const LISTENS_PER_DAY = 3;
export const TRANSCRIPTIONS_PER_DAY = 5;

type UsageRow = {
  questions: number;
  listens: number;
  transcriptions: number;
  last_question_at: string | null;
};

function todayInLagos(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function readUsage(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<UsageRow | null> {
  const { data, error } = await supabase
    .from("ask_scout_usage")
    .select("questions, listens, transcriptions, last_question_at")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .maybeSingle();
  if (error) {
    console.error(
      "[ask-scout] quota read failed",
      JSON.stringify({ error: error.message }),
    );
    return null;
  }
  return (data as UsageRow | null) ?? null;
}

async function writeUsage(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  row: Partial<UsageRow>,
): Promise<void> {
  const { error } = await supabase.from("ask_scout_usage").upsert(
    { user_id: userId, usage_date: today, ...row },
    { onConflict: "user_id,usage_date" },
  );
  if (error) {
    console.error(
      "[ask-scout] quota write failed",
      JSON.stringify({ error: error.message }),
    );
  }
}

export type QuotaDecision = { allowed: true } | { allowed: false; error: string };

/** Check and consume one model question. Call only on the model path. */
export async function checkModelQuota(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuotaDecision> {
  const today = todayInLagos();
  const row = await readUsage(supabase, userId, today);
  if (row === null) {
    // No row yet, or the read failed: allow, and record the question
    // when the write succeeds. A failed read fails open by design.
    await writeUsage(supabase, userId, today, {
      questions: 1,
      last_question_at: new Date().toISOString(),
    });
    return { allowed: true };
  }
  const last = row.last_question_at ? Date.parse(row.last_question_at) : 0;
  if (Date.now() - last < MODEL_QUESTION_MIN_SECONDS * 1000) {
    return { allowed: false, error: "Give Scout a minute between questions." };
  }
  if (row.questions >= MODEL_QUESTIONS_PER_DAY) {
    return {
      allowed: false,
      error:
        "Ask Scout has used up your 5 questions for today. It rests until midnight WAT, then your 5 questions refresh.",
    };
  }
  await writeUsage(supabase, userId, today, {
    questions: row.questions + 1,
    last_question_at: new Date().toISOString(),
  });
  return { allowed: true };
}

/** Check and consume one voice use (Listen play or mic transcription). */
export async function checkVoiceQuota(
  supabase: SupabaseClient,
  userId: string,
  kind: "listens" | "transcriptions",
): Promise<QuotaDecision> {
  const today = todayInLagos();
  const limit = kind === "listens" ? LISTENS_PER_DAY : TRANSCRIPTIONS_PER_DAY;
  const row = await readUsage(supabase, userId, today);
  if (row === null) {
    await writeUsage(supabase, userId, today, { [kind]: 1 });
    return { allowed: true };
  }
  if (row[kind] >= limit) {
    return {
      allowed: false,
      error:
        kind === "listens"
          ? "You have used your 3 Listen plays for today. They refresh at midnight WAT."
          : "You have used your 5 voice questions for today. They refresh at midnight WAT.",
    };
  }
  await writeUsage(supabase, userId, today, { [kind]: row[kind] + 1 });
  return { allowed: true };
}
