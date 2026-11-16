"use client";

import { useRef, useState } from "react";
import { MessageCircle, Mic, Send, Square, Volume2, X } from "lucide-react";
import { renderChatMarkdown } from "@/lib/chat-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function Chatbot({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Voice: recording the question (mic), transcribing it, and
  // playing an answer back (speaker). The Deepgram key stays
  // server-side; the browser only talks to /api/voice/*.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The assistant is for signed-in users only: nothing renders otherwise.
  if (!signedIn) return null;

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const closeChat = () => {
    stopAudio();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setOpen(false);
  };

  const toggleOpen = () => {
    if (open) closeChat();
    else setOpen(true);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
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

  // Mic: tap to record, tap again to stop. The recording is sent to
  // /api/voice/transcribe, and the transcript is sent as the question,
  // so the user sees exactly what was heard. The transcript goes
  // through the same Scout flow as a typed question.
  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("This browser does not support voice input.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          const data: unknown = await res.json().catch(() => null);
          const transcript =
            data &&
            typeof data === "object" &&
            typeof (data as { transcript?: unknown }).transcript === "string"
              ? (data as { transcript: string }).transcript.trim()
              : "";
          if (transcript) {
            await send(transcript);
          } else if (
            data &&
            typeof data === "object" &&
            typeof (data as { error?: unknown }).error === "string"
          ) {
            setVoiceError((data as { error: string }).error);
          } else {
            setVoiceError("I did not catch that. Try again.");
          }
        } catch {
          setVoiceError("Voice transcription failed. Try again.");
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      setVoiceError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in the browser settings and try again."
          : "Could not start the microphone. Try again.",
      );
    }
  };

  // Speaker: hear an answer read aloud. The reply text is sent to
  // /api/voice/speak, which strips the markdown and returns audio.
  // Tapping again stops it; starting another reply stops the first.
  const speak = async (index: number, text: string) => {
    if (playingId === index) {
      stopAudio();
      return;
    }
    stopAudio();
    setVoiceError(null);
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const err =
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Could not play that reply. Try again.";
        setVoiceError(err);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };
      setPlayingId(index);
      await audio.play();
    } catch {
      setVoiceError("Could not play that reply. Try again.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={toggleOpen}
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
              onClick={closeChat}
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
                    {m.role === "assistant" ? (
                      <>
                        {renderChatMarkdown(m.content)}
                        <button
                          type="button"
                          onClick={() => speak(i, m.content)}
                          aria-label={
                            playingId === i
                              ? "Stop listening"
                              : "Listen to this reply"
                          }
                          className="mt-2 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-stone-500 hover:text-green-800"
                        >
                          {playingId === i ? (
                            <Square className="h-3.5 w-3.5" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                          {playingId === i ? "Stop" : "Listen"}
                        </button>
                      </>
                    ) : (
                      m.content
                    )}
                  </div>
                ))}
                {busy ? (
                  <p className="text-xs text-stone-400">Scout is thinking...</p>
                ) : null}
              </div>
            )}
          </div>

          {voiceError ? (
            <p className="border-t border-stone-200 px-3 pt-2 text-xs text-red-700">
              {voiceError}
            </p>
          ) : null}
          <div className="flex items-center gap-2 border-t border-stone-200 px-3 py-2.5">
            <button
              type="button"
              onClick={toggleRecording}
              disabled={busy || transcribing}
              aria-label={recording ? "Stop recording" : "Speak your question"}
              className={
                recording
                  ? "rounded-md bg-red-600 p-2 text-white hover:bg-red-700"
                  : "rounded-md bg-stone-100 p-2 text-stone-600 hover:bg-stone-200 disabled:opacity-50"
              }
            >
              {recording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
            <input
              className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-green-800"
              type="text"
              value={input}
              maxLength={500}
              onChange={(e) => {
                setInput(e.target.value);
                if (voiceError) setVoiceError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder={
                recording
                  ? "Listening... tap the mic to stop"
                  : transcribing
                    ? "Transcribing..."
                    : "Ask about an opportunity..."
              }
              aria-label="Message Scout"
            />
            <button
              type="button"
              onClick={() => send()}
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
