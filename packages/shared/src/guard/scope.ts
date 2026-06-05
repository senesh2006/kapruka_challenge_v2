import type { TenantId } from "../model/primitives.js";
import type { Tenant } from "../model/tenant.js";
import { CrossTenantAccessError, type CrossTenantOperation } from "./errors.js";

export interface TenantOwned {
  tenantId: TenantId;
}

export interface AssertOptions {
  operation?: CrossTenantOperation;
  entity?: string;
}

export class TenantScope {
  readonly tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this.tenantId = tenantId;
  }

  owns<T extends TenantOwned>(entity: T): boolean {
    return entity.tenantId === this.tenantId;
  }

  assertOwns<T extends TenantOwned>(entity: T, options: AssertOptions = {}): T {
    if (!this.owns(entity)) {
      throw new CrossTenantAccessError({
        operation: options.operation ?? "read",
        expectedTenantId: this.tenantId,
        actualTenantId: entity.tenantId,
        ...(options.entity !== undefined ? { entity: options.entity } : {}),
      });
    }
    return entity;
  }

  assertOwnsAll<T extends TenantOwned>(entities: readonly T[], options: AssertOptions = {}): readonly T[] {
    for (const entity of entities) {
      this.assertOwns(entity, options);
    }
    return entities;
  }

  isThisTenant(tenant: Tenant): boolean {
    return tenant.id === this.tenantId;
  }

  assertIsThisTenant(tenant: Tenant, options: AssertOptions = {}): Tenant {
    if (!this.isThisTenant(tenant)) {
      throw new CrossTenantAccessError({
        operation: options.operation ?? "read",
        expectedTenantId: this.tenantId,
        actualTenantId: tenant.id,
        entity: options.entity ?? "Tenant",
      });
    }
    return tenant;
  }
}

export async function guardedRead<T extends TenantOwned>(
  scope: TenantScope,
  fetcher: () => Promise<T | null | undefined>,
  options: AssertOptions = {},
): Promise<T | null> {
  const result = await fetcher();
  if (result === null || result === undefined) return null;
  return scope.assertOwns(result, { ...options, operation: options.operation ?? "read" });
}

export async function guardedList<T extends TenantOwned>(
  scope: TenantScope,
  fetcher: () => Promise<readonly T[]>,
  options: AssertOptions = {},
): Promise<readonly T[]> {
  const result = await fetcher();
  return scope.assertOwnsAll(result, { ...options, operation: options.operation ?? "list" }) as T[];
}

export async function guardedWrite<T extends TenantOwned>(
  scope: TenantScope,
  payload: T,
  writer: (payload: T) => Promise<T>,
  options: AssertOptions = {},
): Promise<T> {
  scope.assertOwns(payload, { ...options, operation: options.operation ?? "write" });
  const persisted = await writer(payload);
  return scope.assertOwns(persisted, { ...options, operation: "read", entity: options.entity ?? "write-result" });
}
