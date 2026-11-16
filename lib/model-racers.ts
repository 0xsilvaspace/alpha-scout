/* ------------------------------------------------------------------ */
/* Model racers: which providers answer a judgment question, and how  */
/* ------------------------------------------------------------------ */

// The chatbot races its providers and the first GOOD answer wins.
// OpenRouter's free tier allows 50 requests a day on a $0-credit key,
// shared across every free model, so firing two OpenRouter models per
// question halved the daily budget. Each question now fires ONE
// OpenRouter model, picked from the verified free list below, and
// only falls back to the next one when the pick fails. That doubles
// the judgment questions the daily budget covers and spreads the
// load across four models instead of two.
//
// The list was read from OpenRouter's public /models endpoint on
// 2026-11-13. Free models churn (names appear and disappear), so a
// model that 404s is skipped by the fallback, never fatal.

export const OPENROUTER_FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "baidu/ernie-5.5-flash-preview:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
] as const;

export type OpenRouterFreeModel = (typeof OPENROUTER_FREE_MODELS)[number];

// Stable per question: the same question always picks the same model,
// different questions spread across the list. A plain hash, so it
// needs no server state (serverless functions do not share memory).
export function pickOpenRouterModel(question: string): OpenRouterFreeModel {
  let hash = 0;
  for (let i = 0; i < question.length; i++) {
    hash = (hash * 31 + question.charCodeAt(i)) >>> 0;
  }
  return OPENROUTER_FREE_MODELS[hash % OPENROUTER_FREE_MODELS.length];
}

// The other models, in list order after the pick, for the sequential
// fallback when the picked model fails.
export function openRouterFallbackOrder(first: OpenRouterFreeModel): OpenRouterFreeModel[] {
  const rest = OPENROUTER_FREE_MODELS.filter((m) => m !== first);
  const idx = OPENROUTER_FREE_MODELS.indexOf(first);
  return [...rest.slice(idx), ...rest.slice(0, idx)];
}

// Optional providers, activated only when their key is set in Vercel:
// - CEREBRAS_API_KEY: Cerebras free tier, 1M tokens/day, no card.
//   gpt-oss-120b is the flagship free model. Sign up at
//   cloud.cerebras.ai, paste the key in Vercel, redeploy.
// - OPENAI_API_KEY: OpenAI has no free API tier, so this needs a
//   paid key (a $5 credit buys gpt-4o-mini for a long time at this
//   volume). Only set it if you decide to pay for it.
// - GEMINI_API_KEY_2: a second Gemini key from a DIFFERENT Google
//   Cloud project. Quotas are per project, so a second key in the
//   same project adds nothing. The Gemini caller tries the second
//   key only when the first is rate-limited (429).
export const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
export const CEREBRAS_MODEL = "gpt-oss-120b";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODEL = "gpt-4o-mini";

export interface ProviderEnv {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

export type ProviderName = "gemini" | "openrouter" | "cerebras" | "openai";

// Which providers can race for this question, from the environment
// actually set. The deterministic path never needs any of them.
export function availableProviders(env: ProviderEnv): ProviderName[] {
  const out: ProviderName[] = [];
  if (env.GEMINI_API_KEY) out.push("gemini");
  if (env.OPENROUTER_API_KEY) out.push("openrouter");
  if (env.CEREBRAS_API_KEY) out.push("cerebras");
  if (env.OPENAI_API_KEY) out.push("openai");
  return out;
}
