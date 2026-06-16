import { z } from "zod";
import type {
  Category,
  DeliveryCity,
  DeliveryQuote,
  OrderConfirmation,
  OrderTracking,
  Product,
  ProductSummary,
  SearchResult,
} from "../types/index.js";
import { ProductId } from "@sevana/shared";

/**
 * Raw Kapruka MCP response schemas (matching the server's JSON output).
 * The server often wraps the structured JSON inside a string in the 'result' field.
 */

const KaprukaPriceSchema = z.object({
  amount: z.number(),
  currency: z.string(),
});

const KaprukaRawProductSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  summary: z.string().optional(),
  price: KaprukaPriceSchema,
  image_url: z.string().url().nullable().optional(),
  in_stock: z.boolean().optional(),
  stock_level: z.string().optional(),
  url: z.string().url(),
});

const KaprukaRawProductSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  price: KaprukaPriceSchema,
  images: z.array(z.string().url()).optional(),
  in_stock: z.boolean().optional(),
  url: z.string().url(),
});

const KaprukaRawCategorySchema = z.object({
  name: z.string(),
  url: z.string().url(),
  children: z.lazy(() => z.array(KaprukaRawCategorySchema)).optional(),
});

const KaprukaRawSearchSchema = z.object({
  results: z.array(KaprukaRawProductSummarySchema).optional(),
  next_cursor: z.string().nullable().optional(),
});

const KaprukaRawDeliveryCitySchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
});

const KaprukaRawDeliveryQuoteSchema = z.object({
  available: z.boolean(),
  rate: z.number().optional(),
  currency: z.string().optional(),
  reason: z.string().nullable().optional(),
});

const KaprukaRawOrderConfirmationSchema = z.object({
  order_ref: z.string(),
  checkout_url: z.string().url(),
  summary: z.object({
    grand_total: z.number(),
    currency: z.string(),
  }),
});

const KaprukaRawTrackingSchema = z.object({
  order_number: z.string(),
  status: z.string(),
  progress: z.array(z.object({ step: z.string(), timestamp: z.string() })).optional(),
});

/**
 * Helper to unwrap the 'result' string wrapper from the MCP server.
 */
function unwrap<T>(raw: unknown): T {
  if (raw !== null && typeof raw === "object" && "result" in raw) {
    const val = (raw as { result: unknown }).result;
    if (typeof val === "string") {
      try {
        return JSON.parse(val) as T;
      } catch {
        // Fallback for non-JSON strings
        return { result: val } as unknown as T;
      }
    }
    return val as T;
  }
  return raw as T;
}

export function normalizeSearchResult(raw: unknown): SearchResult {
  const unwrapped = unwrap<any>(raw);
  if (!unwrapped || typeof unwrapped !== "object") return { items: [] };
  
  // Handle cases where the server returns "No products found..." as a string result
  if (unwrapped.result && typeof unwrapped.result === "string" && unwrapped.result.includes("No products found")) {
    return { items: [] };
  }

  const parsed = KaprukaRawSearchSchema.parse(unwrapped);
  return {
    items: (parsed.results ?? []).map(rawSummaryToCanonical),
    ...(parsed.next_cursor ? { cursor: parsed.next_cursor } : {}),
  };
}

export function normalizeProduct(raw: unknown): Product | null {
  const unwrapped = unwrap<any>(raw);
  if (!unwrapped || typeof unwrapped !== "object" || !unwrapped.id) return null;
  return rawProductToCanonical(KaprukaRawProductSchema.parse(unwrapped));
}

export function normalizeCategories(raw: unknown): Category[] {
  const unwrapped = unwrap<any>(raw);
  if (!unwrapped || !unwrapped.categories) return [];
  const parsed = z.array(KaprukaRawCategorySchema).parse(unwrapped.categories);
  return parsed.map(rawCategoryToCanonical);
}

export function normalizeDeliveryCities(raw: unknown): DeliveryCity[] {
  const unwrapped = unwrap<any>(raw);
  if (!unwrapped || !unwrapped.cities) return [];
  const parsed = z.array(KaprukaRawDeliveryCitySchema).parse(unwrapped.cities);
  return parsed.map((c) => ({
    id: c.name, // Use name as ID since the server doesn't provide IDs in the JSON
    name: c.name,
    aliases: c.aliases ?? [],
  }));
}

export function normalizeDeliveryQuote(raw: unknown): DeliveryQuote {
  const unwrapped = unwrap<any>(raw);
  if (!unwrapped) return { available: false, reason: "No delivery info returned" };
  const r = KaprukaRawDeliveryQuoteSchema.parse(unwrapped);
  return {
    available: r.available,
    rate: r.rate !== undefined ? { amount: r.rate, currency: r.currency ?? "LKR" } : undefined,
    reason: r.reason ?? undefined,
  };
}

export function normalizeOrderConfirmation(raw: unknown): OrderConfirmation {
  const unwrapped = unwrap<any>(raw);
  const r = KaprukaRawOrderConfirmationSchema.parse(unwrapped);
  return {
    retailerOrderRef: r.order_ref,
    payLink: r.checkout_url,
    expectedTotal: { amount: r.summary.grand_total, currency: r.summary.currency },
  };
}

export function normalizeOrderTracking(raw: unknown): OrderTracking {
  const unwrapped = unwrap<any>(raw);
  const r = KaprukaRawTrackingSchema.parse(unwrapped);
  return {
    retailerOrderRef: r.order_number,
    currentStatus: r.status,
    timeline: (r.progress ?? []).map((p) => ({
      status: p.step,
      time: p.timestamp,
    })),
  };
}

function rawSummaryToCanonical(r: z.infer<typeof KaprukaRawProductSummarySchema>): ProductSummary {
  return {
    id: r.id as ProductId,
    title: r.name,
    price: { amount: r.price.amount, currency: r.price.currency },
    thumbnail: r.image_url ?? undefined,
    inStock: r.in_stock ?? true,
    url: r.url,
  };
}

function rawProductToCanonical(r: z.infer<typeof KaprukaRawProductSchema>): Product {
  return {
    id: r.id as ProductId,
    title: r.name,
    description: r.description ?? "",
    price: { amount: r.price.amount, currency: r.price.currency },
    images: r.images ?? [],
    inStock: r.in_stock ?? true,
    url: r.url,
    attributes: {}, 
  };
}

function rawCategoryToCanonical(r: z.infer<typeof KaprukaRawCategorySchema>): Category {
  return {
    id: r.name, 
    name: r.name,
    children: (r.children ?? []).map(rawCategoryToCanonical),
  };
}
