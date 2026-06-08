import {
  TenantScope,
  type Event,
  type TenantId,
} from "@sevana/shared";
import type { EventBus } from "@sevana/connectors";
import type {
  Orchestrator,
  StageEvent,
} from "@sevana/orchestrator";
import type { EventRepository } from "@sevana/storage";

let counter = 0;
function newEventId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/**
 * Translates orchestrator stage events + retailer webhook events into the
 * canonical Event union (PRD §13) and persists them through EventRepository.
 *
 * Each Event is one Blob entry (events/{tenantId}/{id}.json). Analytics
 * consumers (this package's queries, the merchant console) read them back
 * via `EventRepository.list`. For higher throughput, mirror these into a
 * column store; the Blob log remains the immutable source of truth.
 */
export class AnalyticsRecorder {
  private readonly events: EventRepository;

  constructor(opts: { events: EventRepository }) {
    this.events = opts.events;
  }

  /** Wire into an orchestrator instance. Records turn.end + order.created + demand-signal. */
  attachToOrchestrator(orchestrator: Orchestrator): () => void {
    return orchestrator.on((evt) => {
      const translated = this.translateStageEvent(evt);
      if (translated) void this.persist(translated, evt.tenantId);
    });
  }

  /** Subscribe to the webhook event bus. Order / payment / fulfilment events flow straight through. */
  attachToBus(bus: EventBus): () => void {
    return bus.subscribe("*", (event) => {
      void this.persist(event, event.tenantId);
    });
  }

  private async persist(event: Event, tenantId: TenantId): Promise<void> {
    try {
      await this.events.append(event, new TenantScope(tenantId));
    } catch {
      // Recording must never break the path that produced the event. Swallow
      // and rely on operational logging to surface a backlog.
    }
  }

  private translateStageEvent(stage: StageEvent): Event | null {
    switch (stage.kind) {
      case "turn.end": {
        const data = stage.data as { contentLength?: number; channel?: string } | undefined;
        return {
          kind: "conversation",
          id: newEventId("conv"),
          tenantId: stage.tenantId,
          at: new Date(stage.at).toISOString(),
          sessionId: stage.sessionId,
          turnRole: "concierge",
          contentLength: data?.contentLength ?? 0,
          ...(data?.channel
            ? { channel: data.channel as "widget" | "full-page" | "mobile-sdk" | "messaging-whatsapp" }
            : {}),
          guardrailVerdict: "approved",
        };
      }
      case "order.created": {
        const data = stage.data as { retailerOrderRef?: string } | undefined;
        const orderId = data?.retailerOrderRef;
        if (!orderId) return null;
        return {
          kind: "order",
          id: newEventId("ord"),
          tenantId: stage.tenantId,
          at: new Date(stage.at).toISOString(),
          sessionId: stage.sessionId,
          orderId: orderId as never,
          status: "created",
        };
      }
      case "shopper.demand-signal": {
        const data = stage.data as { reason?: string; slotId?: string } | undefined;
        if (!data?.reason) return null;
        return {
          kind: "demand-signal",
          id: newEventId("ds"),
          tenantId: stage.tenantId,
          at: new Date(stage.at).toISOString(),
          sessionId: stage.sessionId,
          reason: data.reason,
          ...(data.slotId ? { slotId: data.slotId } : {}),
        };
      }
      default:
        return null;
    }
  }
}
