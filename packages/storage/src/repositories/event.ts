import {
  EventSchema,
  type Event,
  type TenantId,
  type TenantScope,
} from "@sevana/shared";
import type { BlobStorageAdapter } from "../adapter.js";
import { BlobBackedStore } from "../store.js";

/**
 * Append-only event log. Each event is one blob — analytics consumers list
 * by prefix and stream-read in pages. For high-volume tenants the analytics
 * pipeline would mirror these into a columnar store; the blob log remains
 * the immutable source of truth.
 */
export class EventRepository {
  private readonly store: BlobBackedStore<Event>;

  constructor(adapter: BlobStorageAdapter) {
    this.store = new BlobBackedStore<Event>(adapter, {
      prefix: "events",
      parse: (raw) => EventSchema.parse(raw),
      identify: (e) => ({ id: e.id, tenantId: e.tenantId as TenantId }),
    });
  }

  append(event: Event, scope: TenantScope): Promise<Event> {
    return this.store.put(event, scope);
  }

  get(id: string, scope: TenantScope): Promise<Event | null> {
    return this.store.get(id, scope);
  }

  list(scope: TenantScope): Promise<readonly Event[]> {
    return this.store.list(scope);
  }
}
