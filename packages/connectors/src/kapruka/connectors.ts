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
  const args: Record<string, unknown> = { limit: intent.limit };
  if (intent.query !== undefined) args.query = intent.query;
  if (intent.categoryIds !== undefined) args.category_ids = intent.categoryIds;
  if (intent.occasion !== undefined) args.occasion = intent.occasion;
  if (intent.budget?.min !== undefined) args.budget_min = intent.budget.min.amount;
  if (intent.budget?.max !== undefined) args.budget_max = intent.budget.max.amount;
  if (intent.attributes !== undefined) args.attributes = intent.attributes;
  if (intent.locale !== undefined) args.locale = intent.locale;
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
        { id: String(id) },
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
        {},
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
        {},
        { cacheKey: "delivery-cities", cacheTtlMs: transport.ttls.citiesTtlMs },
      );
      return normalizeDeliveryCities(raw);
    },
    async checkDelivery(city: string, date: string, items: DeliveryQuoteLine[]) {
      // Inventory- and time-sensitive — never cached.
      const raw = await transport.call(KAPRUKA_TOOL_NAMES.delivery.check, {
        city,
        date,
        items,
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
      });
      return normalizeOrderConfirmation(raw);
    },
    async trackOrder(id: OrderId | string) {
      const raw = await transport.call(KAPRUKA_TOOL_NAMES.checkout.track, {
        id: String(id),
      });
      return normalizeOrderTracking(raw);
    },
  };
}
