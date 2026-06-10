import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  RefreshCcw,
  Send,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import {
  ChannelClient,
  type ChannelKind,
  type ConversationTurn,
  type RecommendedCard,
} from "@sevana/channels";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { cn } from "../lib/cn.js";

interface ChatProps {
  channel?: ChannelKind;
  tenantId?: string;
  endpoint?: string;
  /** Heading shown in the header. */
  title?: string;
  subtitle?: string;
  className?: string;
  /** Suggested opener prompts shown when the transcript is empty. */
  suggestions?: string[];
}

const DEFAULT_SUGGESTIONS = [
  "Birthday cake and yellow flowers for amma in Galle",
  "Anniversary surprise — I'm in Sydney, she's in Kandy",
  "Wedding gift for a colleague, budget LKR 12,000",
  "I need to apologise — something thoughtful",
];

let SHARED_CLIENT_CACHE: { client: ChannelClient; key: string } | null = null;

function makeClient(opts: Pick<ChatProps, "channel" | "tenantId" | "endpoint">): ChannelClient {
  const key = `${opts.channel ?? "full-page"}::${opts.tenantId ?? "kapruka"}::${opts.endpoint ?? "/api/turn"}`;
  if (SHARED_CLIENT_CACHE && SHARED_CLIENT_CACHE.key === key) {
    return SHARED_CLIENT_CACHE.client;
  }
  const client = new ChannelClient({
    channel: opts.channel ?? "full-page",
    tenantId: opts.tenantId ?? "kapruka",
    endpoint: opts.endpoint ?? "/api/turn",
  });
  SHARED_CLIENT_CACHE = { client, key };
  return client;
}

export function Chat({
  channel = "full-page",
  tenantId = "kapruka",
  endpoint = "/api/turn",
  title = "Hari",
  subtitle = "Sevana concierge",
  className,
  suggestions = DEFAULT_SUGGESTIONS,
}: ChatProps) {
  const client = useMemo(
    () => makeClient({ channel, tenantId, endpoint }),
    [channel, tenantId, endpoint],
  );
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest turn whenever the transcript changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setError(null);
    const customerTurn: ConversationTurn = {
      id: `c-${Date.now()}`,
      role: "customer",
      content: trimmed,
      at: new Date().toISOString(),
      status: "delivered",
    };
    setTurns((prev) => [...prev, customerTurn]);
    setDraft("");
    setBusy(true);
    try {
      const response = await client.sendTurn(trimmed);
      const conciergeTurn: ConversationTurn = {
        id: `h-${Date.now()}`,
        role: "concierge",
        content: response.reply,
        cardRefs: response.cardRefs,
        cards: response.cards,
        at: response.at,
        status: response.guardrailVerdict === "approved" ? "delivered" : "blocked",
      };
      setTurns((prev) => [...prev, conciergeTurn]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    client.resetSession();
    setTurns([]);
    setError(null);
    setDraft("");
  }

  return (
    <section
      aria-label="Conversation with Hari"
      className={cn(
        "flex h-full min-h-0 flex-col rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-none">{title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          aria-label="Start a new conversation"
          disabled={busy}
        >
          <RefreshCcw className="h-4 w-4" aria-hidden /> New
        </Button>
      </header>

      <div ref={scrollerRef} className="flex-1 min-h-0 space-y-3 overflow-y-auto px-5 py-4">
        {turns.length === 0 && !busy ? (
          <EmptyState onPick={send} suggestions={suggestions} />
        ) : null}
        {turns.map((t) => (
          <Bubble key={t.id} turn={t} />
        ))}
        {busy ? <TypingBubble /> : null}
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
      </div>

      <form
        className="flex items-end gap-2 border-t border-border px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message Hari
        </label>
        <textarea
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          placeholder="Tell Hari the situation — occasion, recipient, budget…"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
        <Button type="submit" disabled={!draft.trim() || busy} aria-label="Send message">
          <Send className="h-4 w-4" aria-hidden /> Send
        </Button>
      </form>
    </section>
  );
}

function Bubble({ turn }: { turn: ConversationTurn }) {
  const isCustomer = turn.role === "customer";
  const hasRichCards = !isCustomer && turn.cards && turn.cards.length > 0;
  return (
    <div className={cn("flex flex-col", isCustomer ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed",
          isCustomer
            ? "bg-primary text-primary-foreground"
            : turn.status === "blocked"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap">{turn.content}</p>
        {!hasRichCards && turn.cardRefs && turn.cardRefs.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {turn.cardRefs.map((ref) => (
              <Badge key={ref} variant="accent">
                <ShoppingBag className="h-3 w-3" aria-hidden /> {ref}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {hasRichCards ? (
        <div className="mt-2 grid w-[80%] gap-2 sm:grid-cols-2">
          {turn.cards!.map((c) => (
            <ProductCard key={String(c.productId)} card={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start" aria-label="Hari is typing">
      <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Dot delayMs={0} />
          <Dot delayMs={150} />
          <Dot delayMs={300} />
        </span>
      </div>
    </div>
  );
}

function Dot({ delayMs }: { delayMs: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60"
      style={{ animationDelay: `${delayMs}ms` }}
    />
  );
}

function EmptyState({
  onPick,
  suggestions,
}: {
  onPick: (s: string) => void;
  suggestions: string[];
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">Tell Hari the situation</p>
        <p className="mt-1 text-sm text-muted-foreground">
          She reads first, then recommends. Try one of these:
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground",
              "transition-colors duration-150 cursor-pointer hover:bg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProductCard({ card }: { card: RecommendedCard }) {
  const imageSrc = card.renderUrl ?? card.imageUrl;
  const isOnModel = Boolean(card.renderUrl);
  const price = `${card.price.currency} ${card.price.amount.toLocaleString()}`;
  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm",
        card.isHero ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
      )}
    >
      <div className="relative aspect-[4/5] w-full bg-muted">
        <img
          src={imageSrc}
          alt={card.title}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {card.isHero ? (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
            Hero
          </span>
        ) : null}
        {isOnModel && !card.renderDegraded ? (
          <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-foreground">
            On-model
          </span>
        ) : null}
        {card.renderDegraded ? (
          <span
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-warning/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning-foreground"
            title="Try-on render failed; showing the flat catalogue image"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden /> flat
          </span>
        ) : null}
      </div>
      <div className="space-y-1 p-3">
        <p className="text-sm font-semibold leading-tight text-foreground">{card.title}</p>
        <p className="font-mono text-xs text-muted-foreground">{price}</p>
        <p className="text-xs leading-snug text-foreground/80">{card.reason}</p>
      </div>
    </article>
  );
}
