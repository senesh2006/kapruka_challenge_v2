import { describe, expect, it, vi } from "vitest";
import { TenantSchema, type Tenant } from "@sevana/shared";
import {
  ConnectorRegistry,
  type CredentialResolver,
  MissingConnectorBindingError,
  MissingCredentialError,
  UnknownConnectorAdapterError,
  createMcpCatalogueConnector,
  createMcpCheckoutConnector,
  createMcpCrmConnector,
  createMcpDeliveryConnector,
  type McpClient,
} from "../src/index.js";

const now = "2026-06-05T10:00:00.000Z";

function buildTenant(overrides: Partial<Tenant> = {}): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: { brandVoice: "warm", languages: ["en"] },
    merchandising: {},
    guardrails: {},
    connectors: [
      { kind: "catalogue", adapter: "mcp", credentialRef: "kap-mcp" },
      { kind: "delivery", adapter: "mcp", credentialRef: "kap-mcp" },
      { kind: "checkout", adapter: "mcp", credentialRef: "kap-mcp" },
    ],
    credentials: [{ ref: "kap-mcp", connectorKind: "catalogue", scopes: [] }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

const fakeResolver: CredentialResolver = {
  resolve: async (ref) => ({ apiKey: `secret-for-${ref}` }),
};

function fakeClient(responses: Record<string, unknown>): McpClient {
  return {
    callTool: vi.fn(async (name: string) => {
      if (!(name in responses)) throw new Error(`unexpected tool call: ${name}`);
      return responses[name];
    }),
  };
}

describe("ConnectorRegistry.resolve", () => {
  it("assembles a RetailerConnector from MCP factories", async () => {
    const client = fakeClient({});
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "mcp", build: () => createMcpDeliveryConnector(client) })
      .register({ kind: "checkout", adapter: "mcp", build: () => createMcpCheckoutConnector(client) });

    const retailer = await registry.resolve(buildTenant(), { credentialResolver: fakeResolver });

    expect(retailer.tenantId).toBe("kapruka");
    expect(retailer.catalogue.kind).toBe("catalogue");
    expect(retailer.delivery.kind).toBe("delivery");
    expect(retailer.checkout.kind).toBe("checkout");
    expect(retailer.crm).toBeUndefined();
  });

  it("omits crm when the tenant has no crm binding", async () => {
    const client = fakeClient({});
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "mcp", build: () => createMcpDeliveryConnector(client) })
      .register({ kind: "checkout", adapter: "mcp", build: () => createMcpCheckoutConnector(client) });

    const retailer = await registry.resolve(buildTenant(), { credentialResolver: fakeResolver });
    expect(retailer.crm).toBeUndefined();
  });

  it("includes crm when bound and registered", async () => {
    const client = fakeClient({});
    const tenant = buildTenant({
      connectors: [
        { kind: "catalogue", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "delivery", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "checkout", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "crm", adapter: "mcp", credentialRef: "kap-mcp" },
      ],
    });
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "mcp", build: () => createMcpDeliveryConnector(client) })
      .register({ kind: "checkout", adapter: "mcp", build: () => createMcpCheckoutConnector(client) })
      .register({ kind: "crm", adapter: "mcp", build: () => createMcpCrmConnector(client) });

    const retailer = await registry.resolve(tenant, { credentialResolver: fakeResolver });
    expect(retailer.crm?.kind).toBe("crm");
  });

  it("throws MissingConnectorBindingError when a required capability is absent", async () => {
    const client = fakeClient({});
    const tenant = buildTenant({
      connectors: [
        { kind: "catalogue", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "delivery", adapter: "mcp", credentialRef: "kap-mcp" },
      ],
    });
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "mcp", build: () => createMcpDeliveryConnector(client) });

    await expect(registry.resolve(tenant, { credentialResolver: fakeResolver })).rejects.toBeInstanceOf(
      MissingConnectorBindingError,
    );
  });

  it("throws UnknownConnectorAdapterError when the bound adapter is not registered", async () => {
    const tenant = buildTenant({
      connectors: [
        { kind: "catalogue", adapter: "rest", credentialRef: "kap-mcp" },
        { kind: "delivery", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "checkout", adapter: "mcp", credentialRef: "kap-mcp" },
      ],
    });
    const client = fakeClient({});
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "mcp", build: () => createMcpDeliveryConnector(client) })
      .register({ kind: "checkout", adapter: "mcp", build: () => createMcpCheckoutConnector(client) });

    await expect(registry.resolve(tenant, { credentialResolver: fakeResolver })).rejects.toBeInstanceOf(
      UnknownConnectorAdapterError,
    );
  });

  it("throws MissingCredentialError when binding references an unknown credential", async () => {
    const tenant = buildTenant({
      connectors: [
        { kind: "catalogue", adapter: "mcp", credentialRef: "nope" },
        { kind: "delivery", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "checkout", adapter: "mcp", credentialRef: "kap-mcp" },
      ],
    });
    const client = fakeClient({});
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "mcp", build: () => createMcpDeliveryConnector(client) })
      .register({ kind: "checkout", adapter: "mcp", build: () => createMcpCheckoutConnector(client) });

    await expect(registry.resolve(tenant, { credentialResolver: fakeResolver })).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
  });

  it("supports mixed adapters per tenant (mcp catalogue + rest delivery)", async () => {
    const client = fakeClient({});
    const restDeliveryStub = {
      kind: "delivery" as const,
      adapter: "rest",
      listDeliveryCities: async () => [],
      checkDelivery: async () => ({ available: false, perishableWarnings: [] }),
    };
    const tenant = buildTenant({
      connectors: [
        { kind: "catalogue", adapter: "mcp", credentialRef: "kap-mcp" },
        { kind: "delivery", adapter: "rest", credentialRef: "kap-mcp" },
        { kind: "checkout", adapter: "mcp", credentialRef: "kap-mcp" },
      ],
    });
    const registry = new ConnectorRegistry()
      .register({ kind: "catalogue", adapter: "mcp", build: () => createMcpCatalogueConnector(client) })
      .register({ kind: "delivery", adapter: "rest", build: () => restDeliveryStub })
      .register({ kind: "checkout", adapter: "mcp", build: () => createMcpCheckoutConnector(client) });

    const retailer = await registry.resolve(tenant, { credentialResolver: fakeResolver });
    expect(retailer.catalogue.adapter).toBe("mcp");
    expect(retailer.delivery.adapter).toBe("rest");
    expect(retailer.checkout.adapter).toBe("mcp");
  });
});

describe("MCP default adapter dispatches and validates", () => {
  it("catalogue.searchProducts calls the configured tool and parses the result", async () => {
    const client = fakeClient({
      kapruka_search_products: {
        items: [
          {
            id: "p-1",
            title: "Roses",
            imageUrl: "https://img.example.com/r.jpg",
            price: { amount: 5500, currency: "LKR" },
            categoryIds: ["flowers"],
            available: true,
          },
        ],
      },
    });
    const cat = createMcpCatalogueConnector(client);
    const result = await cat.searchProducts({ query: "roses", limit: 5 });
    expect(result.items[0]?.id).toBe("p-1");
    expect(client.callTool).toHaveBeenCalledWith(
      "kapruka_search_products",
      expect.objectContaining({ query: "roses" }),
    );
  });

  it("catalogue.getProduct returns null when the tool returns null", async () => {
    const client = fakeClient({ kapruka_get_product: null });
    const cat = createMcpCatalogueConnector(client);
    const result = await cat.getProduct("missing" as never);
    expect(result).toBeNull();
  });

  it("rejects malformed payloads via Zod parsing", async () => {
    const client = fakeClient({ kapruka_list_delivery_cities: [{ id: 1 }] });
    const delivery = createMcpDeliveryConnector(client);
    await expect(delivery.listDeliveryCities()).rejects.toBeTruthy();
  });
});
