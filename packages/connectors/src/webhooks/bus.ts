import type { Event } from "@sevana/shared";

export type EventKind = Event["kind"];
export type EventHandler = (event: Event) => Promise<void> | void;

export interface EventBus {
  publish(event: Event): Promise<void>;
  subscribe(kind: EventKind | "*", handler: EventHandler): () => void;
}

/**
 * In-memory pub/sub for the orchestrator + analytics + retention services.
 * Handler errors are aggregated and re-thrown so the receiver can release the
 * idempotency reservation and let the retailer re-deliver the webhook.
 */
export class InMemoryEventBus implements EventBus {
  private readonly byKind = new Map<EventKind | "*", Set<EventHandler>>();

  subscribe(kind: EventKind | "*", handler: EventHandler): () => void {
    const set = this.byKind.get(kind) ?? new Set<EventHandler>();
    set.add(handler);
    this.byKind.set(kind, set);
    return () => {
      set.delete(handler);
    };
  }

  async publish(event: Event): Promise<void> {
    const handlers = new Set<EventHandler>();
    for (const h of this.byKind.get(event.kind) ?? []) handlers.add(h);
    for (const h of this.byKind.get("*") ?? []) handlers.add(h);

    const errors: unknown[] = [];
    await Promise.all(
      [...handlers].map(async (h) => {
        try {
          await h(event);
        } catch (err) {
          errors.push(err);
        }
      }),
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "event bus handler errors");
  }
}
