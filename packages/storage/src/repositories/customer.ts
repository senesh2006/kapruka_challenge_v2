import {
  CustomerProfileSchema,
  type CustomerId,
  type CustomerProfile,
  type TenantId,
  type TenantScope,
} from "@sevana/shared";
import type { BlobStorageAdapter } from "../adapter.js";
import { BlobBackedStore } from "../store.js";

/**
 * Persists consented customer profiles + the taste-and-relationship graph
 * (PRD §8). Memory is opt-in: callers must check `profile.consent.memoryOptIn`
 * before invoking `upsert`. The Retention agent does this.
 */
export class CustomerProfileRepository {
  private readonly store: BlobBackedStore<CustomerProfile>;

  constructor(adapter: BlobStorageAdapter) {
    this.store = new BlobBackedStore<CustomerProfile>(adapter, {
      prefix: "customers",
      parse: (raw) => CustomerProfileSchema.parse(raw),
      identify: (p) => ({ id: String(p.id), tenantId: p.tenantId as TenantId }),
    });
  }

  get(id: CustomerId, scope: TenantScope): Promise<CustomerProfile | null> {
    return this.store.get(String(id), scope);
  }

  upsert(profile: CustomerProfile, scope: TenantScope): Promise<CustomerProfile> {
    return this.store.put(profile, scope);
  }

  list(scope: TenantScope): Promise<readonly CustomerProfile[]> {
    return this.store.list(scope);
  }

  /** Customer-facing "delete my data" affordance (FR-14, PRD §16). */
  delete(id: CustomerId, scope: TenantScope): Promise<void> {
    return this.store.delete(String(id), scope);
  }
}
