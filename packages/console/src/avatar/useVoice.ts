import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser Web Speech API voice loop (free, no keys). Speech-to-text for the
 * customer, text-to-speech for Hari. Strong in Chrome/Edge; degrades to
 * `supported: false` where the API is missing (Firefox STT, some mobile),
 * so the UI can fall back to typed input.
 */

type LocaleHint = "en" | "si" | "ta" | "tanglish";

const BCP47: Record<LocaleHint, string> = {
  en: "en-US",
  si: "si-LK",
  ta: "ta-LK",
  tanglish: "en-US", // romanised — English engine handles it best
};

// Minimal SpeechRecognition typings (not in standard lib.dom across TS versions).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceResult {
  /** Both STT and TTS available. */
  sttSupported: boolean;
  ttsSupported: boolean;
  listening: boolean;
  speaking: boolean;
  /** Live (interim + final) transcript while listening. */
  interim: string;
  /** Begin listening; resolves the final transcript via onFinal. */
  startListening: (locale: LocaleHint, onFinal: (text: string) => void) => void;
  stopListening: () => void;
  /** Speak text in the given locale; lip-sync reads `speaking`. */
  speak: (text: string, locale: LocaleHint) => void;
  cancelSpeak: () => void;
}

export function useVoice(): UseVoiceResult {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef<((text: string) => void) | null>(null);

  const sttSupported = getRecognitionCtor() !== null;
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startListening = useCallback(
    (locale: LocaleHint, onFinal: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;
      // Cancel any in-flight recognition.
      recognitionRef.current?.abort();
      const rec = new Ctor();
      rec.lang = BCP47[locale];
      rec.continuous = false;
      rec.interimResults = true;
      onFinalRef.current = onFinal;
      setInterim("");

      rec.onresult = (e) => {
        let interimText = "";
        let finalText = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
        if (interimText) setInterim(interimText);
        if (finalText) {
          setInterim("");
          onFinalRef.current?.(finalText.trim());
        }
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);

      recognitionRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    [],
  );

  const cancelSpeak = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback(
    (text: string, locale: LocaleHint) => {
      if (!ttsSupported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = BCP47[locale];
      utt.rate = 1.0;
      utt.pitch = 1.05;
      // Prefer a voice matching the language if one exists.
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang === utt.lang) ?? voices.find((v) => v.lang.startsWith(locale === "tanglish" ? "en" : locale));
      if (match) utt.voice = match;
      utt.onstart = () => setSpeaking(true);
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utt);
    },
    [ttsSupported],
  );

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    sttSupported,
    ttsSupported,
    listening,
    speaking,
    interim,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
  };
}
