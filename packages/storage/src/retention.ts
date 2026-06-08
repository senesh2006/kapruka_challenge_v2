import type { CustomerProfile, Session, Tenant } from "@sevana/shared";
import { TenantScope } from "@sevana/shared";
import type {
  CandidatePlan,
  RetentionAgent,
} from "@sevana/orchestrator";
import type { CustomerProfileRepository } from "./repositories/customer.js";

/**
 * Storage-backed Retention agent (PRD §8). Reads + writes consented profiles
 * via `CustomerProfileRepository`. Memory is opt-in, transparent, editable:
 * the customer-facing surfaces use the same repository's `delete` to honour
 * "delete my data" requests (FR-14).
 *
 * Drop-in replacement for `InMemoryRetentionAgent` from @sevana/orchestrator.
 */
export class StorageRetentionAgent implements RetentionAgent {
  constructor(private readonly profiles: CustomerProfileRepository) {}

  async load(input: { session: Session; tenant: Tenant }): Promise<CustomerProfile | null> {
    if (!input.session.customerId) return null;
    const scope = new TenantScope(input.tenant.id);
    return this.profiles.get(input.session.customerId, scope);
  }

  async update(input: {
    session: Session;
    plan: CandidatePlan;
    profile?: CustomerProfile;
  }): Promise<void> {
    if (!input.profile) return;
    if (!input.profile.consent.memoryOptIn) return;

    // Bump `updatedAt`. Real implementation also updates the taste graph
    // with signals from the plan; for the scaffold we just persist consent
    // and the latest known shape so the customer can view + edit it.
    const next: CustomerProfile = {
      ...input.profile,
      updatedAt: new Date().toISOString(),
    };
    const scope = new TenantScope(input.profile.tenantId);
    await this.profiles.upsert(next, scope);
  }
}
