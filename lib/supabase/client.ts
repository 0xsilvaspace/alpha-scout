import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null | undefined;

/** Browser Supabase client (one shared instance). Null when env vars are missing. */
export function getBrowserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!url || !anonKey) {
    client = null;
    return null;
  }
  client = createBrowserClient(url, anonKey);
  return client;
}
