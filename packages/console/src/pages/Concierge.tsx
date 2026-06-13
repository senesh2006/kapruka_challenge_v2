import { useCallback, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import {
  ChannelClient,
  type ConciergeEmotion,
  type RecommendedCard,
} from "@sevana/channels";
import { Avatar3D } from "../avatar/Avatar3D.js";
import { useVoice } from "../avatar/useVoice.js";
import { Button } from "../components/ui/Button.js";
import { cn } from "../lib/cn.js";

type LocaleHint = "en" | "si" | "ta" | "tanglish";

const EMOTION_LABEL: Record<ConciergeEmotion, string> = {
  neutral: "Listening",
  warm: "Warm",
  excited: "Excited",
  thoughtful: "Thinking it through",
  apologetic: "Gentle",
  celebratory: "Celebrating with you",
};

const AVATAR_URL = (import.meta.env.VITE_AVATAR_URL as string | undefined)?.trim() || undefined;

export function ConciergePage() {
  const client = useMemo(
    () => new ChannelClient({ channel: "full-page", tenantId: "kapruka", endpoint: "/api/turn" }),
    [],
  );
  const voice = useVoice();
  const [emotion, setEmotion] = useState<ConciergeEmotion>("warm");
  const [reply, setReply] = useState<string>(
    "Tell me the situation — an occasion, who it's for, the feeling — and I'll take it from there.",
  );
  const [cards, setCards] = useState<RecommendedCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const localeRef = useRef<LocaleHint>("en");

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
        if (res.detectedLocale) localeRef.current = res.detectedLocale;
        if (!muted) voice.speak(res.reply, localeRef.current);
      } catch (err) {
        setReply(err instanceof Error ? err.message : String(err));
        setEmotion("apologetic");
      } finally {
        setBusy(false);
      }
    },
    [busy, client, muted, voice],
  );

  const onMic = useCallback(() => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    voice.cancelSpeak();
    voice.startListening(localeRef.current, (finalText) => void send(finalText));
  }, [voice, send]);

  return (
    <div className="relative -mx-6 -my-8 h-[calc(100vh-4rem)] overflow-hidden bg-gradient-to-b from-background to-muted/40 lg:-mx-10">
      {/* Avatar stage */}
      <div className="absolute inset-0">
        <Avatar3D
          {...(AVATAR_URL ? { avatarUrl: AVATAR_URL } : {})}
          emotion={emotion}
          speaking={voice.speaking}
          listening={voice.listening}
        />
      </div>

      {/* Top status */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-center justify-between p-6">
        <div className="flex items-center gap-2 rounded-full bg-card/80 px-3 py-1.5 shadow-sm backdrop-blur">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-semibold">Hari</span>
          <span className="text-xs text-muted-foreground">· {EMOTION_LABEL[emotion]}</span>
        </div>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute Hari" : "Mute Hari"}
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-card/80 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Caption + cards + controls */}
      <div className="absolute bottom-0 left-0 right-0 space-y-3 p-6">
        {cards.length > 0 ? (
          <div className="mx-auto flex max-w-3xl gap-3 overflow-x-auto pb-1">
            {cards.map((c) => (
              <article
                key={String(c.productId)}
                className="w-40 shrink-0 overflow-hidden rounded-lg border border-border bg-card/90 shadow-sm backdrop-blur"
              >
                <img src={c.renderUrl ?? c.imageUrl} alt={c.title} className="aspect-[4/5] w-full object-cover" loading="lazy" />
                <div className="space-y-0.5 p-2">
                  <p className="truncate text-xs font-semibold">{c.title}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {c.price.currency} {c.price.amount.toLocaleString()}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="mx-auto max-w-2xl rounded-2xl bg-card/85 p-4 shadow-lg backdrop-blur">
          <p className={cn("min-h-[3rem] text-sm leading-relaxed", busy && "text-muted-foreground")}>
            {voice.interim ? <span className="text-muted-foreground italic">{voice.interim}</span> : reply}
          </p>
          <div className="mt-3 flex items-end gap-2">
            {voice.sttSupported ? (
              <Button
                type="button"
                variant={voice.listening ? "destructive" : "primary"}
                size="icon"
                onClick={onMic}
                aria-label={voice.listening ? "Stop listening" : "Talk to Hari"}
                className="shrink-0"
              >
                {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            ) : null}
            <form
              className="flex flex-1 items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
                setDraft("");
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={voice.sttSupported ? "…or type the situation" : "Tell Hari the situation"}
                disabled={busy}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || busy} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
          {!voice.ttsSupported ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Voice output isn't available in this browser — Hari replies in text. Try Chrome or Edge for the full voice experience.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
