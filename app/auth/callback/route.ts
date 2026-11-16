import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Handles the confirmation link sent in the sign-up email. Supabase
 * appends a `code` to this URL; exchanging it creates the session and
 * signs the user in, then sends them back to the home page.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const home = new URL(next.startsWith("/") ? next : "/", req.url);

  if (code) {
    const supabase = await getServerSupabase();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(home);
      }
    }
  }

  // No code, or the exchange failed: send the user home. The header
  // still shows Sign in, so they can try again from there.
  return NextResponse.redirect(home);
}
