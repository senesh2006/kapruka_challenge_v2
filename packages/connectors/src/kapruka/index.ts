import type { TenantId } from "@sevana/shared";
import type { McpClient } from "../mcp/client.js";
import type {
  ConnectorFactoryContext,
  ConnectorRegistry,
  CredentialPayload,
} from "../registry/index.js";
import type { Clock } from "./clock.js";
import {
  createKaprukaCatalogueConnector,
  createKaprukaCheckoutConnector,
  createKaprukaDeliveryConnector,
} from "./connectors.js";
import type { FaultInjectionConfig } from "./fault.js";
import { KAPRUKA_ADAPTER } from "./tool-names.js";
import { KaprukaTransport, type KaprukaTransportOptions } from "./transport.js";

export * from "./cache.js";
export * from "./clock.js";
export * from "./connectors.js";
export * from "./fault.js";
export * from "./normalize.js";
export * from "./rate-limiter.js";
export * from "./tool-names.js";
export * from "./transport.js";

export interface KaprukaAdapterOptions {
  /**
   * Build an MCP client from the tenant's resolved credential. The credential
   * is closed over inside the client — it does NOT live on the transport,
   * the connector, or any object exposed to channel adapters.
   */
  buildClient: (credential: CredentialPayload) => McpClient;
  clock?: Clock;
  rateLimit?: KaprukaTransportOptions["rateLimit"];
  retry?: KaprukaTransportOptions["retry"];
  cache?: KaprukaTransportOptions["cache"];
  faultInjection?: FaultInjectionConfig;
}

export interface KaprukaAdapterHandle {
  /**
   * Look up the transport instance for a given tenant. For operations
   * (cache eviction, fault-injection toggles) — NOT for channel-facing code.
   */
  getTransport(tenantId: TenantId): KaprukaTransport | undefined;
  /** Drop a tenant's transport (e.g. after a credential rotation). */
  evict(tenantId: TenantId): void;
}

/**
 * Registers the Kapruka MCP adapter for `catalogue`, `delivery`, and
 * `checkout` on the given registry. A single `KaprukaTransport` instance is
 * shared across the three capability connectors per tenant so rate limits
 * and cache are correctly scoped to one credential.
 */
export function registerKaprukaAdapter(
  registry: ConnectorRegistry,
  options: KaprukaAdapterOptions,
): KaprukaAdapterHandle {
  const transports = new Map<string, KaprukaTransport>();

  const ensureTransport = (ctx: ConnectorFactoryContext): KaprukaTransport => {
    const key = String(ctx.tenant.id);
    const existing = transports.get(key);
    if (existing) return existing;
    const client = options.buildClient(ctx.credential);
    const transport = new KaprukaTransport({
      client,
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
      ...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
      ...(options.retry !== undefined ? { retry: options.retry } : {}),
      ...(options.cache !== undefined ? { cache: options.cache } : {}),
      ...(options.faultInjection !== undefined
        ? { faultInjection: options.faultInjection }
        : {}),
    });
    transports.set(key, transport);
    return transport;
  };

  registry
    .register({
      kind: "catalogue",
      adapter: KAPRUKA_ADAPTER,
      build: (ctx) => createKaprukaCatalogueConnector(ensureTransport(ctx)),
    })
    .register({
      kind: "delivery",
      adapter: KAPRUKA_ADAPTER,
      build: (ctx) => createKaprukaDeliveryConnector(ensureTransport(ctx)),
    })
    .register({
      kind: "checkout",
      adapter: KAPRUKA_ADAPTER,
      build: (ctx) => createKaprukaCheckoutConnector(ensureTransport(ctx)),
    });

  return {
    getTransport: (tenantId) => transports.get(String(tenantId)),
    evict: (tenantId) => {
      transports.delete(String(tenantId));
    },
  };
}
