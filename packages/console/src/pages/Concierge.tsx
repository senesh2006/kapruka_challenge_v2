import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import {
  ChannelClient,
  type ConciergeEmotion,
  type RecommendedCard,
} from "@sevana/channels";
import { AvatarStage } from "../avatar/AvatarStage.js";
import { useVoice } from "../avatar/useVoice.js";
import { cn } from "../lib/cn.js";

type LocaleHint = "en" | "si" | "ta" | "tanglish";

const EMOTION_LABEL: Record<ConciergeEmotion, string> = {
  neutral: "Listening",
  warm: "Warm",
  excited: "Excited for you",
  thoughtful: "Thinking it through",
  apologetic: "Gentle",
  celebratory: "Celebrating with you",
  condolence: "Here for you",
};

export function ConciergePage() {
  const client = useMemo(
    () => new ChannelClient({ channel: "full-page", tenantId: "kapruka", endpoint: "/api/turn" }),
    [],
  );
  const voice = useVoice();
  const [emotion, setEmotion] = useState<ConciergeEmotion>("warm");
  const [reply, setReply] = useState<string>(
    "Tell me the situation — the occasion, who it's for, the feeling. I'll take it from there.",
  );
  const [cards, setCards] = useState<RecommendedCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [locale, setLocale] = useState<LocaleHint>("en");
  const localeRef = useRef<LocaleHint>("en");

  // Keep ref in sync for the callback closures
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return;
      setBusy(true);
      setReply("…");
      try {
        const res = await client.sendTurn(text);
        setReply(res.reply);
        setCards(res.cards);
        setEmotion(res.emotion);
        // If the backend detected a different locale, sync it
        if (res.detectedLocale && res.detectedLocale !== locale) {
          setLocale(res.detectedLocale as LocaleHint);
        }
        if (!muted) voice.speak(res.reply, localeRef.current);
      } catch (err) {
        setReply(err instanceof Error ? err.message : String(err));
        setEmotion("apologetic");
      } finally {
        setBusy(false);
      }
    },
    [busy, client, muted, voice, locale],
  );

  const onMic = useCallback(() => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    voice.cancelSpeak();
    voice.startListening(localeRef.current, (final) => void send(final));
  }, [voice, send]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-amber-50 via-white to-amber-50 text-foreground antialiased">
      {/* Soft background motes */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-20 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute -right-24 top-60 h-80 w-80 rounded-full bg-rose-200/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-yellow-200/40 blur-3xl" />
      </div>

      {/* Single column, centered. */}
      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center px-5 py-8 sm:py-12">
        {/* Top — nav & mute toggle. */}
        <header className="flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium tracking-wide text-foreground/70">Hari</span>
            <div className="flex gap-1 rounded-full bg-black/5 p-1">
              {(["en", "si", "ta"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase transition-all",
                    locale === l ? "bg-white text-black shadow-sm" : "text-foreground/40 hover:text-foreground/60"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute Hari" : "Mute Hari"}
            className="grid h-9 w-9 place-items-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/5"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </header>

        {/* Avatar */}
        <div className="mt-8 flex w-full justify-center overflow-visible">
          <div className="relative h-64 w-64 sm:h-80 sm:w-80 overflow-visible flex items-center justify-center">
            <AvatarStage
              emotion={emotion}
              speaking={voice.speaking}
              listening={voice.listening}
              speechPulse={voice.speechPulse}
            />
          </div>
        </div>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-foreground/50">
          {voice.listening ? "Listening…" : voice.speaking ? "Speaking" : EMOTION_LABEL[emotion]}
        </p>

        {/* Caption */}
        <p
          className={cn(
            "mt-7 max-w-xl text-center text-base leading-relaxed text-foreground sm:text-lg",
            busy && "text-foreground/50",
          )}
        >
          {voice.interim ? <em className="text-foreground/50">{voice.interim}</em> : reply}
        </p>

        {/* Cards (only when there's something to show) */}
        {cards.length > 0 ? (
          <div className="mt-6 flex w-full gap-3 overflow-x-auto pb-4">
            {cards.map((c) => (
              <article key={String(c.productId)} className="product-card">
                <div className="image_container">
                  {c.renderUrl || c.imageUrl ? (
                    <img src={c.renderUrl ?? c.imageUrl} alt={c.title} loading="lazy" />
                  ) : (
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="image-placeholder">
                      <path d="M20 5H4V19L13.2923 9.70649C13.6828 9.31595 14.3159 9.31591 14.7065 9.70641L20 15.0104V5ZM2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9C10 10.1046 9.10457 11 8 11Z"></path>
                    </svg>
                  )}
                </div>
                <div className="title">
                  <span>{c.title}</span>
                </div>
                <div className="size">
                  <span>Size</span>
                  <ul className="list-size">
                    {["37", "38", "39", "40", "41"].map((s) => (
                      <li key={s} className="item-list">
                        <button className="item-list-button">{s}</button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="action">
                  <div className="price">
                    <span>
                      {c.price.currency === "USD" ? "$" : c.price.currency}
                      {c.price.amount.toLocaleString()}
                    </span>
                  </div>
                  <button className="cart-button">
                    <svg
                      className="cart-icon"
                      stroke="currentColor"
                      stroke-width="1.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      ></path>
                    </svg>
                    <span>Add to cart</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="flex-1" />

        {/* Input dock */}
        <form
          className="sticky bottom-4 mt-8 flex w-full items-center gap-2 rounded-full bg-white/90 p-1.5 pl-2 shadow-md ring-1 ring-black/5 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
            setDraft("");
          }}
        >
          {voice.sttSupported ? (
            <button
              type="button"
              onClick={onMic}
              aria-label={voice.listening ? "Stop listening" : "Talk to Hari"}
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-colors",
                voice.listening
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-amber-400 hover:bg-amber-500",
              )}
            >
              {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          ) : null}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={voice.sttSupported ? "…or type the situation" : "Tell Hari the situation"}
            disabled={busy}
            className="flex-1 bg-transparent px-2 py-2 text-sm placeholder:text-foreground/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>

        {!voice.ttsSupported ? (
          <p className="mt-2 text-center text-[11px] text-foreground/40">
            Voice output isn't available in this browser — Hari replies in text. Try Chrome or Edge for the full voice experience.
          </p>
        ) : null}
      </div>
    </main>
  );
}
