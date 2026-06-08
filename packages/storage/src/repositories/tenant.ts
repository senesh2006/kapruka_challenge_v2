import { TenantSchema, type Tenant, type TenantId } from "@sevana/shared";
import type { BlobStorageAdapter } from "../adapter.js";

/**
 * Tenant repository.
 *
 * The Tenant entity is its own scope — `Tenant.id` IS the tenantId. So this
 * sits at `tenants/{id}.json` rather than `{prefix}/{tenantId}/{id}.json` and
 * doesn't use `BlobBackedStore` (which assumes the entity is per-tenant).
 *
 * Cross-tenant reads are still prevented by callers using `TenantScope.assertIsThisTenant`.
 */
export class TenantRepository {
  private static readonly PREFIX = "tenants";

  constructor(private readonly adapter: BlobStorageAdapter) {}

  private pathname(id: TenantId): string {
    return `${TenantRepository.PREFIX}/${encodeURIComponent(String(id))}.json`;
  }

  async get(id: TenantId): Promise<Tenant | null> {
    const raw = await this.adapter.get(this.pathname(id));
    if (raw === null) return null;
    return TenantSchema.parse(JSON.parse(raw));
  }

  async put(tenant: Tenant): Promise<Tenant> {
    const validated = TenantSchema.parse(tenant);
    await this.adapter.put(this.pathname(tenant.id), JSON.stringify(validated));
    return validated;
  }

  async list(): Promise<readonly Tenant[]> {
    const pathnames = await this.adapter.list(`${TenantRepository.PREFIX}/`);
    const out: Tenant[] = [];
    for (const pathname of pathnames) {
      const raw = await this.adapter.get(pathname);
      if (raw === null) continue;
      out.push(TenantSchema.parse(JSON.parse(raw)));
    }
    return out;
  }

  async delete(id: TenantId): Promise<void> {
    await this.adapter.delete(this.pathname(id));
  }
}
