"use client";

import { useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function Chatbot({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // The assistant is for signed-in users only: nothing renders otherwise.
  if (!signedIn) return null;

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text } as ChatMessage];
    setMessages(next);
    setInput("");
    setBusy(true);
    scrollDown();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-10) }),
      });
      const data: unknown = await res.json().catch(() => null);
      const reply =
        data && typeof data === "object" && "reply" in data
          ? String((data as { reply: unknown }).reply)
          : data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Something went wrong. Try again.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Try again." },
      ]);
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ask Scout"
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-green-800 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-green-900"
      >
        <MessageCircle className="h-5 w-5" />
        Ask Scout
      </button>

      {open ? (
        <div className="fixed bottom-20 right-4 z-40 flex h-[480px] max-h-[70vh] w-[min(92vw,360px)] flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">
                Ask Scout
              </h2>
              <p className="text-xs text-stone-500">
                Answers come from the opportunities listed on this site.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded p-1 text-stone-400 hover:text-stone-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-4 py-3"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <p className="text-sm leading-relaxed text-stone-500">
                Ask for a summary of an opportunity, or a briefing on what
                it needs: eligibility, deadline, steps and the official
                source.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={
                      m.role === "user"
                        ? "ml-8 rounded-lg bg-green-800 px-3 py-2 text-sm text-white"
                        : "mr-8 rounded-lg bg-stone-100 px-3 py-2 text-sm leading-relaxed text-stone-800"
                    }
                  >
                    {m.content}
                  </div>
                ))}
                {busy ? (
                  <p className="text-xs text-stone-400">Scout is thinking...</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-stone-200 px-3 py-2.5">
            <input
              className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-green-800"
              type="text"
              value={input}
              maxLength={500}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder="Ask about an opportunity..."
              aria-label="Message Scout"
            />
            <button
              type="button"
              onClick={send}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="rounded-md bg-green-800 p-2 text-white hover:bg-green-900 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
