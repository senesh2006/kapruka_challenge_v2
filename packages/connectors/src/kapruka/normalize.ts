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

/**
 * Raw Kapruka MCP shapes (snake_case) and normalizers that map them onto the
 * canonical Sevana types. If the MCP returns nothing, normalizers return an
 * explicit empty result — never an invented product, price, or status.
 */

const KaprukaRawProductSummarySchema = z.object({
  product_id: z.string().min(1),
  name: z.string(),
  thumbnail: z.string().url(),
  price_lkr: z.number().nonnegative(),
  category_ids: z.array(z.string()).optional(),
  in_stock: z.boolean().optional(),
});

const KaprukaRawProductSchema = KaprukaRawProductSummarySchema.extend({
  description: z.string().optional(),
  images: z.array(z.string().url()).optional(),
  attributes: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  perishable: z.boolean().optional(),
});

const KaprukaRawSearchSchema = z.object({
  results: z.array(KaprukaRawProductSummarySchema).optional(),
  next_cursor: z.string().optional(),
});

const KaprukaRawCategorySchema = z.object({
  category_id: z.string(),
  name: z.string(),
  parent_id: z.string().optional(),
});

const KaprukaRawCategoryListSchema = z.union([
  z.array(KaprukaRawCategorySchema),
  z.object({ categories: z.array(KaprukaRawCategorySchema) }),
]);

const KaprukaRawCitySchema = z.object({
  city_id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  region: z.string().optional(),
});

const KaprukaRawDeliveryQuoteSchema = z.object({
  available: z.boolean(),
  earliest_date: z.string().datetime().optional(),
  fee_lkr: z.number().nonnegative().optional(),
  perishable_warnings: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

const KaprukaRawOrderSchema = z.object({
  order_ref: z.string().min(1),
  pay_link: z.string().url(),
  total: z.number().nonnegative(),
  currency: z.string().length(3),
});

const KaprukaRawTrackingStepSchema = z.object({
  status: z.string(),
  at: z.string().datetime(),
  notes: z.string().optional(),
});

const KaprukaRawTrackingSchema = z.object({
  order_ref: z.string().min(1),
  status: z.string(),
  timeline: z.array(KaprukaRawTrackingStepSchema).optional(),
  pay_link: z.string().url().optional(),
});

type KaprukaRawProductSummary = z.infer<typeof KaprukaRawProductSummarySchema>;
type KaprukaRawProduct = z.infer<typeof KaprukaRawProductSchema>;

function rawSummaryToCanonical(r: KaprukaRawProductSummary): ProductSummary {
  return {
    id: r.product_id as ProductSummary["id"],
    title: r.name,
    imageUrl: r.thumbnail,
    price: { amount: r.price_lkr, currency: "LKR" as ProductSummary["price"]["currency"] },
    categoryIds: r.category_ids ?? [],
    available: r.in_stock ?? true,
  };
}

function rawProductToCanonical(r: KaprukaRawProduct): Product {
  return {
    ...rawSummaryToCanonical(r),
    ...(r.description !== undefined ? { description: r.description } : {}),
    images: r.images ?? [],
    attributes: r.attributes ?? {},
    perishable: r.perishable ?? false,
  };
}

export function normalizeSearchResult(raw: unknown): SearchResult {
  if (raw === null || raw === undefined) return { items: [] };
  const parsed = KaprukaRawSearchSchema.parse(raw);
  return {
    items: (parsed.results ?? []).map(rawSummaryToCanonical),
    ...(parsed.next_cursor !== undefined ? { cursor: parsed.next_cursor } : {}),
  };
}

export function normalizeProduct(raw: unknown): Product | null {
  if (raw === null || raw === undefined) return null;
  return rawProductToCanonical(KaprukaRawProductSchema.parse(raw));
}

export function normalizeCategories(raw: unknown): Category[] {
  if (raw === null || raw === undefined) return [];
  const parsed = KaprukaRawCategoryListSchema.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.categories;
  return arr.map((c) => ({
    id: c.category_id,
    name: c.name,
    ...(c.parent_id !== undefined ? { parentId: c.parent_id } : {}),
  }));
}

export function normalizeDeliveryCities(raw: unknown): DeliveryCity[] {
  if (raw === null || raw === undefined) return [];
  const arr = z.array(KaprukaRawCitySchema).parse(raw);
  return arr.map((c) => ({
    id: c.city_id,
    name: c.name,
    aliases: c.aliases ?? [],
    ...(c.region !== undefined ? { region: c.region } : {}),
  }));
}

export function normalizeDeliveryQuote(raw: unknown): DeliveryQuote {
  if (raw === null || raw === undefined) {
    return { available: false, perishableWarnings: [], reason: "no response from MCP" };
  }
  const r = KaprukaRawDeliveryQuoteSchema.parse(raw);
  const lkr = "LKR" as ProductSummary["price"]["currency"];
  return {
    available: r.available,
    ...(r.earliest_date !== undefined ? { earliestDate: r.earliest_date } : {}),
    ...(r.fee_lkr !== undefined ? { fee: { amount: r.fee_lkr, currency: lkr } } : {}),
    perishableWarnings: r.perishable_warnings ?? [],
    ...(r.reason !== undefined ? { reason: r.reason } : {}),
  };
}

export function normalizeOrderConfirmation(raw: unknown): OrderConfirmation {
  const r = KaprukaRawOrderSchema.parse(raw);
  const currency = r.currency.toUpperCase() as OrderConfirmation["currency"];
  return {
    retailerOrderRef: r.order_ref,
    payLink: r.pay_link,
    currency,
    expectedTotal: { amount: r.total, currency },
  };
}

export function normalizeOrderTracking(raw: unknown): OrderTracking {
  const r = KaprukaRawTrackingSchema.parse(raw);
  return {
    retailerOrderRef: r.order_ref,
    currentStatus: r.status,
    timeline: r.timeline ?? [],
    ...(r.pay_link !== undefined ? { payLink: r.pay_link } : {}),
  };
}
