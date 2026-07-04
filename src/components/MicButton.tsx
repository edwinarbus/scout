"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input via the browser's built-in Web Speech API (Chrome + Safari) —
 * no API key, no upload, and interim results stream live into the search box
 * as you speak. On end (click, or the browser detecting you finished), the
 * final transcript is handed up and the search runs.
 *
 * Renders nothing on browsers without SpeechRecognition; typed search is
 * always unaffected.
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function MicButton({
  disabled,
  size = "md",
  onInterim,
  onFinal,
  onError,
}: {
  disabled?: boolean;
  size?: "md" | "lg";
  /** Streams the live (partial) transcript as the user speaks. */
  onInterim: (text: string) => void;
  /** Called once with the full transcript when the user finishes. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  // Detect support after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    setSupported(getSpeechRecognition() != null);
    return () => recRef.current?.abort();
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop(); // triggers onend → final handoff
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true; // keep listening through natural pauses
    rec.interimResults = true; // live text while speaking
    finalRef.current = "";

    rec.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      finalRef.current = final.trim();
      onInterim([final, interim].join(" ").replace(/\s+/g, " ").trim());
    };
    rec.onerror = (e) => {
      // "no-speech"/"aborted" are routine; only surface real failures.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        onError("Microphone blocked — allow mic access in the browser, or just type.");
      } else if (e.error === "network") {
        onError("Speech recognition needs a network connection — or just type.");
      }
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalRef.current;
      if (text) onFinal(text);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      onError("Couldn't start the microphone — try again, or just type.");
    }
  }, [onInterim, onFinal, onError]);

  if (!supported) return null;

  const dims = size === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      aria-label={listening ? "Stop listening and search" : "Speak your search"}
      title={listening ? "Listening — click when you're done" : "Speak your search"}
      className={`relative flex ${dims} shrink-0 items-center justify-center rounded-full transition disabled:opacity-50 ${
        listening
          ? "scout-ring bg-rose-500 text-white shadow-lg"
          : "bg-white text-ink-500 ring-1 ring-black/10 hover:-translate-y-0.5 hover:text-ink-800 hover:shadow-md"
      }`}
    >
      {listening ? (
        <span className="flex items-end gap-[3px]" aria-hidden>
          <span className="scout-eq h-3 w-[3px] rounded-full bg-white" />
          <span className="scout-eq h-4 w-[3px] rounded-full bg-white [animation-delay:120ms]" />
          <span className="scout-eq h-2.5 w-[3px] rounded-full bg-white [animation-delay:240ms]" />
          <span className="scout-eq h-3.5 w-[3px] rounded-full bg-white [animation-delay:360ms]" />
        </span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="22" />
        </svg>
      )}
    </button>
  );
}
