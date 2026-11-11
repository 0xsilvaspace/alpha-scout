/**
 * ALPHA SCOUT — GitHub live deals feed.
 *
 * The deployed app fetches this JSON at runtime from the public
 * `0xsilvaspace/alpha-scout` GitHub repo (raw.githubusercontent.com).
 * The repo's deals.json is refreshed by a scheduled sync (every 4h) from
 * the ALPHA SCOUT Space's 2-hour scan, so the live site updates without
 * a redeploy. Until that repo exists / the fetch succeeds, the app falls
 * back silently to the baked-in snapshot in lib/deals.ts.
 */

import type { Deal } from "./deals";

export const FEED_URL =
  "https://raw.githubusercontent.com/0xsilvaspace/alpha-scout/main/deals.json";

/** How long to wait for the live feed before falling back to the snapshot. */
const FEED_TIMEOUT_MS = 8000;

export interface LiveFeed {
  deals: Deal[];
  generatedAt: string;
}

function isValidDeal(d: unknown): d is Deal {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.id === "number" &&
    typeof o.title === "string" &&
    typeof o.track === "string" &&
    typeof o.sourceUrl === "string" &&
    typeof o.estimatedValue === "string" &&
    typeof o.eligibility === "string" &&
    typeof o.costType === "string" &&
    typeof o.actionSteps === "string" &&
    typeof o.verification === "string" &&
    (o.valueUsd === null || typeof o.valueUsd === "number") &&
    (o.expiresOn === null || typeof o.expiresOn === "string")
  );
}

/**
 * Fetch the live feed. Returns null on ANY failure (network, timeout,
 * non-200, malformed JSON, empty/invalid deals) so the caller can fall
 * back silently to the baked-in snapshot.
 */
export async function fetchLiveFeed(): Promise<LiveFeed | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(FEED_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return null;
    const { deals, generatedAt } = json as {
      deals?: unknown;
      generatedAt?: unknown;
    };
    if (!Array.isArray(deals) || deals.length === 0) return null;
    if (!deals.every(isValidDeal)) return null;
    return {
      deals: deals as Deal[],
      generatedAt:
        typeof generatedAt === "string"
          ? generatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
