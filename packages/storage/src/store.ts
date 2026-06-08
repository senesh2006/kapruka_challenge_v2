import {
  CrossTenantAccessError,
  type TenantId,
  type TenantScope,
} from "@sevana/shared";
import type { BlobStorageAdapter } from "./adapter.js";

export interface BlobStoreConfig<T> {
  /** Path prefix for this entity type, e.g. "sessions". */
  prefix: string;
  /** Runtime parser — re-validates every read. Throws on a bad shape. */
  parse: (raw: unknown) => T;
  /** Extract (id, tenantId) from an entity. */
  identify: (entity: T) => { id: string; tenantId: TenantId };
}

/**
 * Generic per-tenant Blob-backed store. Every entry's pathname is
 * `{prefix}/{tenantId}/{id}.json` so a query for one tenant can never even
 * see another tenant's blobs. Tenant ownership is also asserted at the
 * application layer via `TenantScope` — defence in depth.
 */
export class BlobBackedStore<T> {
  private readonly adapter: BlobStorageAdapter;
  private readonly config: BlobStoreConfig<T>;

  constructor(adapter: BlobStorageAdapter, config: BlobStoreConfig<T>) {
    this.adapter = adapter;
    this.config = config;
  }

  pathname(id: string, tenantId: TenantId): string {
    return `${this.config.prefix}/${String(tenantId)}/${encodeURIComponent(id)}.json`;
  }

  async get(id: string, scope: TenantScope): Promise<T | null> {
    const raw = await this.adapter.get(this.pathname(id, scope.tenantId));
    if (raw === null) return null;
    const parsed = this.config.parse(JSON.parse(raw));
    const key = this.config.identify(parsed);
    if (key.tenantId !== scope.tenantId) {
      throw new CrossTenantAccessError({
        operation: "read",
        expectedTenantId: scope.tenantId,
        actualTenantId: key.tenantId,
        entity: this.config.prefix,
      });
    }
    return parsed;
  }

  async put(entity: T, scope: TenantScope): Promise<T> {
    const key = this.config.identify(entity);
    if (key.tenantId !== scope.tenantId) {
      throw new CrossTenantAccessError({
        operation: "write",
        expectedTenantId: scope.tenantId,
        actualTenantId: key.tenantId,
        entity: this.config.prefix,
      });
    }
    const validated = this.config.parse(entity);
    await this.adapter.put(
      this.pathname(key.id, key.tenantId),
      JSON.stringify(validated),
    );
    return validated;
  }

  async list(scope: TenantScope): Promise<readonly T[]> {
    const prefix = `${this.config.prefix}/${String(scope.tenantId)}/`;
    const pathnames = await this.adapter.list(prefix);
    const out: T[] = [];
    for (const pathname of pathnames) {
      const raw = await this.adapter.get(pathname);
      if (raw === null) continue;
      const parsed = this.config.parse(JSON.parse(raw));
      const key = this.config.identify(parsed);
      if (key.tenantId !== scope.tenantId) continue;
      out.push(parsed);
    }
    return out;
  }

  async delete(id: string, scope: TenantScope): Promise<void> {
    const existing = await this.get(id, scope);
    if (existing === null) return;
    await this.adapter.delete(this.pathname(id, scope.tenantId));
  }
}
