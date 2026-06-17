import type { OrderContext, OrderId, ProductId } from "@sevana/shared";
import type { CatalogueConnector } from "../catalogue/index.js";
import type { CheckoutConnector } from "../checkout/index.js";
import type { DeliveryConnector } from "../delivery/index.js";
import type {
  DeliveryQuoteLine,
  SearchIntent,
} from "../types/index.js";
import { stableStringify } from "./cache.js";
import {
  normalizeCategories,
  normalizeDeliveryCities,
  normalizeDeliveryQuote,
  normalizeOrderConfirmation,
  normalizeOrderTracking,
  normalizeProduct,
  normalizeSearchResult,
} from "./normalize.js";
import { KAPRUKA_ADAPTER, KAPRUKA_TOOL_NAMES } from "./tool-names.js";
import type { KaprukaTransport } from "./transport.js";

function intentToArgs(intent: SearchIntent): Record<string, unknown> {
  const args: Record<string, unknown> = { limit: intent.limit, response_format: "json" };
  if (intent.query !== undefined) args.q = intent.query;
  if (intent.categoryIds && intent.categoryIds.length > 0) {
    args.category = intent.categoryIds[0];
  }
  if (intent.budget?.min !== undefined) args.min_price = intent.budget.min.amount;
  if (intent.budget?.max !== undefined) args.max_price = intent.budget.max.amount;
  if (intent.cursor !== undefined) args.cursor = intent.cursor;
  return args;
}

export function createKaprukaCatalogueConnector(
  transport: KaprukaTransport,
): CatalogueConnector {
  return {
    kind: "catalogue",
    adapter: KAPRUKA_ADAPTER,
    async searchProducts(intent) {
      const args = intentToArgs(intent);
      const raw = await transport.call(KAPRUKA_TOOL_NAMES.catalogue.search, args, {
        cacheKey: `search::${stableStringify(args)}`,
        cacheTtlMs: transport.ttls.searchTtlMs,
      });
      return normalizeSearchResult(raw);
    },
    async getProduct(id: ProductId) {
      const raw = await transport.call(
        KAPRUKA_TOOL_NAMES.catalogue.get,
        { product_id: String(id), response_format: "json" },
        {
          cacheKey: `product::${String(id)}`,
          cacheTtlMs: transport.ttls.productTtlMs,
        },
      );
      return normalizeProduct(raw);
    },
    async listCategories() {
      const raw = await transport.call(
        KAPRUKA_TOOL_NAMES.catalogue.listCategories,
        { response_format: "json" },
        { cacheKey: "categories", cacheTtlMs: transport.ttls.categoriesTtlMs },
      );
      return normalizeCategories(raw);
    },
  };
}

export function createKaprukaDeliveryConnector(
  transport: KaprukaTransport,
): DeliveryConnector {
  return {
    kind: "delivery",
    adapter: KAPRUKA_ADAPTER,
    async listDeliveryCities() {
      const raw = await transport.call(
        KAPRUKA_TOOL_NAMES.delivery.listCities,
        { response_format: "json" },
        { cacheKey: "delivery-cities", cacheTtlMs: transport.ttls.citiesTtlMs },
      );
      return normalizeDeliveryCities(raw);
    },
    async checkDelivery(city: string, date: string, items: DeliveryQuoteLine[]) {
      // Inventory- and time-sensitive — never cached.
      const raw = await transport.call(KAPRUKA_TOOL_NAMES.delivery.check, {
        city,
        delivery_date: date,
        items,
        response_format: "json",
      });
      return normalizeDeliveryQuote(raw);
    },
  };
}

export function createKaprukaCheckoutConnector(
  transport: KaprukaTransport,
): CheckoutConnector {
  return {
    kind: "checkout",
    adapter: KAPRUKA_ADAPTER,
    async createOrder(orderContext: OrderContext) {
      const raw = await transport.call(KAPRUKA_TOOL_NAMES.checkout.createOrder, {
        order: orderContext as unknown as Record<string, unknown>,
        response_format: "json",
      });
      return normalizeOrderConfirmation(raw);
    },
    async trackOrder(id: OrderId | string) {
      const raw = await transport.call(KAPRUKA_TOOL_NAMES.checkout.track, {
        order_number: String(id),
        response_format: "json",
      });
      return normalizeOrderTracking(raw);
    },
  };
}
