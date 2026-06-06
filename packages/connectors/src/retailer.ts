import type { TenantId } from "@sevana/shared";
import type { CatalogueConnector } from "./catalogue/index.js";
import type { CheckoutConnector } from "./checkout/index.js";
import type { CrmConnector } from "./crm/index.js";
import type { DeliveryConnector } from "./delivery/index.js";

/**
 * The retailer-facing aggregate connector, scoped to a single tenant.
 *
 * The orchestrator only ever talks to a `RetailerConnector` — never to a raw
 * MCP or REST client. This is the seam that lets us swap transports per
 * retailer without touching agent code.
 */
export interface RetailerConnector {
  readonly tenantId: TenantId;
  readonly catalogue: CatalogueConnector;
  readonly delivery: DeliveryConnector;
  readonly checkout: CheckoutConnector;
  /** CRM is optional — absent when the retailer has no CRM binding. */
  readonly crm: CrmConnector | undefined;
}
