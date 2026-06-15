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
  /**
   * Monotonically incremented on every word boundary the SpeechSynthesis
   * utterance fires — the lip-sync layer reads this so the mouth actually
   * pulses on each spoken word, not a fake oscillation.
   */
  speechPulse: number;
  /** Begin listening; resolves the final transcript via onFinal. */
  startListening: (locale: LocaleHint, onFinal: (text: string) => void) => void;
  stopListening: () => void;
  /** Speak text in the given locale; lip-sync reads `speaking` + `speechPulse`. */
  speak: (text: string, locale: LocaleHint) => void;
  cancelSpeak: () => void;
}

export function useVoice(): UseVoiceResult {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [speechPulse, setSpeechPulse] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pulseIntervalRef = useRef<number | null>(null);
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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (pulseIntervalRef.current) {
      clearInterval(pulseIntervalRef.current);
      pulseIntervalRef.current = null;
    }
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback(
    (text: string, locale: LocaleHint) => {
      if (!text.trim()) return;

      // Cancel any current speaking
      cancelSpeak();

      const lang = BCP47[locale];
      const langPrefix = lang.split("-")[0] ?? "en";
      
      const voices = typeof window !== "undefined" ? window.speechSynthesis.getVoices() : [];
      
      // High-quality neural voice hunt
      // 1. Edge "Natural" voices are the best free voices available.
      // 2. Chrome "Google" voices are the next best.
      const match = voices.find((v) => v.lang === lang && v.name.includes("Online (Natural)")) 
                 ?? voices.find((v) => v.lang.startsWith(langPrefix) && v.name.includes("Online (Natural)"))
                 ?? voices.find((v) => v.lang === lang && v.name.startsWith("Google"))
                 ?? voices.find((v) => v.lang.startsWith(langPrefix) && v.name.startsWith("Google"))
                 ?? voices.find((v) => v.lang === lang)
                 ?? voices.find((v) => v.lang.startsWith(langPrefix));

      const hasNativeVoice = !!match && (match.name.includes("Online (Natural)") || match.name.startsWith("Google"));

      // Fallback for Sinhala (which usually doesn't have a high-quality native voice in browsers) 
      // or if no high-quality native voice found.
      if (locale === "si" || !hasNativeVoice) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langPrefix}&client=tw-ob`;
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onplay = () => {
          setSpeaking(true);
          // Simulate mouth pulse for audio fallback
          pulseIntervalRef.current = window.setInterval(() => {
            setSpeechPulse((p) => p + 1);
          }, 200);
        };
        audio.onended = () => {
          setSpeaking(false);
          if (pulseIntervalRef.current) {
            clearInterval(pulseIntervalRef.current);
            pulseIntervalRef.current = null;
          }
        };
        audio.onerror = () => {
          setSpeaking(false);
          if (pulseIntervalRef.current) {
            clearInterval(pulseIntervalRef.current);
            pulseIntervalRef.current = null;
          }
        };

        audio.play().catch(() => setSpeaking(false));
        return;
      }

      // Native SpeechSynthesis with high-quality voice
      if (!ttsSupported) return;
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = lang;
      utt.rate = 0.95; // Slightly slower for better naturalness
      utt.pitch = 1.0;
      utt.voice = match;

      utt.onstart = () => setSpeaking(true);
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      utt.onboundary = (e: SpeechSynthesisEvent) => {
        if (e.name === "word") setSpeechPulse((p) => p + 1);
      };
      window.speechSynthesis.speak(utt);
    },
    [ttsSupported, cancelSpeak],
  );

  useEffect(() => {
    // Force a voice list refresh for browsers that load them async (Chrome/Edge)
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
    
    return () => {
      recognitionRef.current?.abort();
      cancelSpeak();
    };
  }, [cancelSpeak]);

  return {
    sttSupported,
    ttsSupported,
    listening,
    speaking,
    interim,
    speechPulse,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
  };
}
