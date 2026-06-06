import type { CustomerProfile, OrderContext, OrderId, ProductId } from "@sevana/shared";
import type { CatalogueConnector } from "../catalogue/index.js";
import type { CheckoutConnector } from "../checkout/index.js";
import type { CrmConnector } from "../crm/index.js";
import type { DeliveryConnector } from "../delivery/index.js";
import {
  CategorySchema,
  CrmCustomerSnapshotSchema,
  type CustomerLookup,
  type DeliveryCity,
  DeliveryCitySchema,
  type DeliveryQuote,
  DeliveryQuoteSchema,
  type DeliveryQuoteLine,
  OrderConfirmationSchema,
  OrderTrackingSchema,
  ProductSchema,
  type SearchIntent,
  type SearchResult,
  SearchResultSchema,
} from "../types/index.js";
import { z } from "zod";
import {
  DEFAULT_MCP_TOOL_NAMES,
  type McpClient,
  type McpToolNames,
} from "./client.js";

const ADAPTER = "mcp";

/**
 * Default catalogue connector backed by MCP tool calls. Validates every
 * response with Zod so the orchestrator never receives a malformed payload.
 */
export function createMcpCatalogueConnector(
  client: McpClient,
  toolNames: McpToolNames["catalogue"] = DEFAULT_MCP_TOOL_NAMES.catalogue,
): CatalogueConnector {
  return {
    kind: "catalogue",
    adapter: ADAPTER,
    async searchProducts(intent: SearchIntent): Promise<SearchResult> {
      const raw = await client.callTool(toolNames.search, intent as unknown as Record<string, unknown>);
      return SearchResultSchema.parse(raw);
    },
    async getProduct(id: ProductId) {
      const raw = await client.callTool(toolNames.get, { id });
      if (raw === null || raw === undefined) return null;
      return ProductSchema.parse(raw);
    },
    async listCategories() {
      const raw = await client.callTool(toolNames.listCategories, {});
      return z.array(CategorySchema).parse(raw);
    },
  };
}

export function createMcpDeliveryConnector(
  client: McpClient,
  toolNames: McpToolNames["delivery"] = DEFAULT_MCP_TOOL_NAMES.delivery,
): DeliveryConnector {
  return {
    kind: "delivery",
    adapter: ADAPTER,
    async listDeliveryCities(): Promise<DeliveryCity[]> {
      const raw = await client.callTool(toolNames.listCities, {});
      return z.array(DeliveryCitySchema).parse(raw);
    },
    async checkDelivery(
      city: string,
      date: string,
      items: DeliveryQuoteLine[],
    ): Promise<DeliveryQuote> {
      const raw = await client.callTool(toolNames.check, { city, date, items });
      return DeliveryQuoteSchema.parse(raw);
    },
  };
}

export function createMcpCheckoutConnector(
  client: McpClient,
  toolNames: McpToolNames["checkout"] = DEFAULT_MCP_TOOL_NAMES.checkout,
): CheckoutConnector {
  return {
    kind: "checkout",
    adapter: ADAPTER,
    async createOrder(orderContext: OrderContext) {
      const raw = await client.callTool(toolNames.createOrder, {
        orderContext: orderContext as unknown as Record<string, unknown>,
      });
      return OrderConfirmationSchema.parse(raw);
    },
    async trackOrder(id: OrderId | string) {
      const raw = await client.callTool(toolNames.track, { id });
      return OrderTrackingSchema.parse(raw);
    },
  };
}

export function createMcpCrmConnector(
  client: McpClient,
  toolNames: McpToolNames["crm"] = DEFAULT_MCP_TOOL_NAMES.crm,
): CrmConnector {
  return {
    kind: "crm",
    adapter: ADAPTER,
    async findCustomer(lookup: CustomerLookup) {
      const raw = await client.callTool(toolNames.findCustomer, lookup as unknown as Record<string, unknown>);
      if (raw === null || raw === undefined) return null;
      return CrmCustomerSnapshotSchema.parse(raw);
    },
    async upsertProfile(profile: CustomerProfile) {
      const raw = await client.callTool(toolNames.upsertProfile, {
        profile: profile as unknown as Record<string, unknown>,
      });
      return CrmCustomerSnapshotSchema.parse(raw);
    },
  };
}
