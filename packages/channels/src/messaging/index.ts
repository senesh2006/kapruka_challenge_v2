import type { RecommendedCard, TurnResponse } from "../client/types.js";

export const MESSAGING_CHANNEL = "messaging-whatsapp" as const;

/**
 * Channel-agnostic messaging envelope mapped onto provider-specific shapes
 * by the `MessagingProvider`. Models the subset of WhatsApp Cloud API
 * message types Sevana actually uses (text, image with caption, interactive
 * buttons). Other messaging providers (Viber, Messenger, Telegram) wrap the
 * same envelope.
 */
export type MessagingMessage =
  | { type: "text"; text: string }
  | {
      type: "image";
      url: string;
      caption?: string;
    }
  | {
      type: "interactive-buttons";
      header?: string;
      body: string;
      buttons: ReadonlyArray<{ id: string; label: string }>;
    };

/**
 * One inbound message from a customer. Providers (WhatsApp webhook, etc.)
 * normalise their wire shape into this before handing it to the orchestrator.
 */
export interface IncomingMessage {
  /** Channel-specific recipient handle (phone number, room id, …). */
  from: string;
  /** Tenant this customer belongs to. Set by the provider's auth layer. */
  tenantId: string;
  text: string;
  at: string;
}

/**
 * Outbound delivery interface. Production providers wrap the WhatsApp Cloud
 * API or similar; tests use `StubMessagingProvider` to capture sends in
 * memory.
 */
export interface MessagingProvider {
  readonly id: string;
  send(to: string, messages: ReadonlyArray<MessagingMessage>): Promise<void>;
  onIncoming(handler: (msg: IncomingMessage) => Promise<void> | void): () => void;
}

export class StubMessagingProvider implements MessagingProvider {
  readonly id = "stub";
  readonly sent: Array<{ to: string; messages: MessagingMessage[] }> = [];
  private readonly handlers = new Set<(msg: IncomingMessage) => Promise<void> | void>();

  async send(to: string, messages: ReadonlyArray<MessagingMessage>): Promise<void> {
    this.sent.push({ to, messages: [...messages] });
  }

  onIncoming(handler: (msg: IncomingMessage) => Promise<void> | void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Test affordance — fan a fake inbound message out to subscribers. */
  async deliverIncoming(msg: IncomingMessage): Promise<void> {
    for (const h of this.handlers) await h(msg);
  }
}

const MAX_REPLY_LENGTH = 1024; // WhatsApp body cap

export interface MapTurnOptions {
  /** Include up to this many product cards as image messages. Default: 3. */
  maxCards?: number;
  /** Build interactive buttons under the reply. Default: false. */
  includeButtons?: boolean;
}

/**
 * Translate one orchestrator turn into a sequence of messaging-channel
 * messages. The hero card becomes an image with the title in the caption;
 * additional cards follow. Optional interactive buttons close with
 * "confirm" / "see more" / "talk to a human" — these become callback ids
 * the provider's onIncoming handler routes back to the orchestrator.
 */
export function mapTurnToMessages(
  response: TurnResponse,
  opts: MapTurnOptions = {},
): MessagingMessage[] {
  const out: MessagingMessage[] = [];
  const reply = truncate(response.reply, MAX_REPLY_LENGTH);
  out.push({ type: "text", text: reply });

  const max = Math.max(0, opts.maxCards ?? 3);
  const cards = response.cards.slice(0, max);
  for (const card of cards) {
    out.push(cardToImage(card));
  }

  if (opts.includeButtons && cards.length > 0) {
    out.push({
      type: "interactive-buttons",
      body: "Shall I confirm, or would you like to see more options?",
      buttons: [
        { id: "confirm", label: "Confirm" },
        { id: "more", label: "See more" },
        { id: "human", label: "Talk to a human" },
      ],
    });
  }
  return out;
}

function cardToImage(card: RecommendedCard): MessagingMessage {
  const caption = `${card.title} — ${card.reason}\n${card.price.currency} ${card.price.amount.toLocaleString()}`;
  return {
    type: "image",
    url: card.renderUrl ?? card.imageUrl,
    caption: truncate(caption, 1024),
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
