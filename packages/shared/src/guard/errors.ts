import type { TenantId } from "../model/primitives.js";

export type CrossTenantOperation = "read" | "write" | "list" | "delete";

export interface CrossTenantAccessDetails {
  operation: CrossTenantOperation;
  expectedTenantId: TenantId;
  actualTenantId: TenantId;
  entity?: string;
}

export class CrossTenantAccessError extends Error {
  readonly operation: CrossTenantOperation;
  readonly expectedTenantId: TenantId;
  readonly actualTenantId: TenantId;
  readonly entity: string | undefined;

  constructor(details: CrossTenantAccessDetails) {
    const entityPart = details.entity ? ` on ${details.entity}` : "";
    super(
      `Cross-tenant ${details.operation}${entityPart} refused: ` +
        `scope=${details.expectedTenantId} entity=${details.actualTenantId}`,
    );
    this.name = "CrossTenantAccessError";
    this.operation = details.operation;
    this.expectedTenantId = details.expectedTenantId;
    this.actualTenantId = details.actualTenantId;
    this.entity = details.entity;
  }
}
