"use client";

import { useState } from "react";
import { LogOut, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "check-email";

function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email or password did not match. Try again, or create an account.";
  }
  if (m.includes("user already registered") || m.includes("already registered")) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (m.includes("expired")) {
    return "That confirmation link expired. Ask for a new email below.";
  }
  if (m.includes("password")) {
    return "Use a password of at least 6 characters.";
  }
  if (m.includes("email")) {
    return "Enter a valid email address.";
  }
  return message;
}

export default function AuthPanel({
  open,
  onClose,
  userEmail,
  onSignedOut,
}: {
  open: boolean;
  onClose: () => void;
  userEmail: string | null;
  onSignedOut: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const supabase = getBrowserSupabase();

  const resetMessages = () => {
    setError("");
    setNotice("");
  };

  const handleSignUp = async () => {
    resetMessages();
    if (!supabase) {
      setError("Sign up is not set up yet. Try again later.");
      return;
    }
    if (password.length < 6) {
      setError("Use a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setBusy(false);
    if (error) {
      setError(friendlyError(error.message));
      return;
    }
    setMode("check-email");
    setNotice(
      `We sent a confirmation email to ${email}. Click the link in it to verify your account.`,
    );
  };

  const handleResend = async () => {
    resetMessages();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setBusy(false);
    if (error) {
      setError(friendlyError(error.message));
      return;
    }
    setNotice(`A new confirmation email is on its way to ${email}.`);
  };

  const handleSignIn = async () => {
    resetMessages();
    if (!supabase) {
      setError("Sign in is not set up yet. Try again later.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setError(friendlyError(error.message));
      return;
    }
    onClose();
  };

  const handleSignOut = async () => {
    if (supabase) await supabase.auth.signOut();
    onSignedOut();
    onClose();
  };

  const inputClass =
    "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-green-800";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 p-4 pt-24"
      role="dialog"
      aria-label="Account"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-900">
            {userEmail
              ? "Your account"
              : mode === "signup"
                ? "Create an account"
                : mode === "check-email"
                ? "Check your email"
                : "Sign in"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-stone-400 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {userEmail ? (
          <div className="mt-4">
            <p className="text-sm text-stone-600">
              Signed in as{" "}
              <span className="font-medium text-stone-900">{userEmail}</span>
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Your saved archive is kept with this account, so it follows
              you across devices.
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        ) : mode === "check-email" ? (
          <div className="mt-4">
            {notice ? (
              <p className="text-sm leading-relaxed text-stone-600">{notice}</p>
            ) : null}
            <p className="mt-2 text-sm leading-relaxed text-stone-500">
              The link signs you in and brings you back here. If it has
              expired, ask for a new email below.
            </p>
            {error ? (
              <p className="mt-2 text-sm text-red-700">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="mt-4 w-full rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-400 disabled:opacity-50"
            >
              Resend confirmation email
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-md bg-green-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-900"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm leading-relaxed text-stone-600">
              {mode === "signup"
                ? "Save opportunities to your archive and ask Scout, the site assistant. Optional, and free."
                : "Sign in to see your saved archive and ask Scout, the site assistant."}
            </p>
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Email
              <input
                className={inputClass + " mt-1"}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Password
              <input
                className={inputClass + " mt-1"}
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
            {error ? (
              <p className="mt-2 text-sm text-red-700">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={mode === "signup" ? handleSignUp : handleSignIn}
              disabled={busy || !email || !password}
              className="mt-4 w-full rounded-md bg-green-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-900 disabled:opacity-50"
            >
              {busy
                ? "Please wait..."
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-center text-sm text-green-800 hover:underline"
              onClick={() => {
                resetMessages();
                setMode(mode === "signup" ? "signin" : "signup");
              }}
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
