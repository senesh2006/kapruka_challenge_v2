import { z } from "zod";
import {
  CurrencyCodeSchema,
  LocaleSchema,
  MoneySchema,
  ProductIdSchema,
} from "@sevana/shared";

/**
 * Catalogue
 *
 * `searchProducts` takes a structured intent rather than a raw query string so
 * the concierge can express situational shopping context (occasion, recipient,
 * budget) without forcing the connector into a specific natural-language API.
 */
export const SearchIntentSchema = z.object({
  query: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
  occasion: z.string().optional(),
  budget: z
    .object({ min: MoneySchema.optional(), max: MoneySchema.optional() })
    .optional(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  locale: LocaleSchema.optional(),
  limit: z.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});
export type SearchIntent = z.infer<typeof SearchIntentSchema>;

export const ProductSummarySchema = z.object({
  id: ProductIdSchema,
  title: z.string(),
  imageUrl: z.string().url(),
  price: MoneySchema,
  categoryIds: z.array(z.string()).default([]),
  available: z.boolean().default(true),
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

export const ProductSchema = ProductSummarySchema.extend({
  description: z.string().optional(),
  images: z.array(z.string().url()).default([]),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  perishable: z.boolean().default(false),
});
export type Product = z.infer<typeof ProductSchema>;

export const SearchResultSchema = z.object({
  items: z.array(ProductSummarySchema),
  cursor: z.string().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
});
export type Category = z.infer<typeof CategorySchema>;

/**
 * Delivery
 *
 * `listDeliveryCities` returns canonical cities with vernacular aliases so the
 * Logistics agent can resolve free-text destinations. `checkDelivery` returns
 * an availability quote, including perishable warnings for items like cakes.
 */
export const DeliveryCitySchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  region: z.string().optional(),
});
export type DeliveryCity = z.infer<typeof DeliveryCitySchema>;

export const DeliveryQuoteLineSchema = z.object({
  productId: ProductIdSchema,
  quantity: z.number().int().positive(),
});
export type DeliveryQuoteLine = z.infer<typeof DeliveryQuoteLineSchema>;

export const DeliveryQuoteSchema = z.object({
  available: z.boolean(),
  earliestDate: z.string().datetime().optional(),
  fee: MoneySchema.optional(),
  perishableWarnings: z.array(z.string()).default([]),
  reason: z.string().optional(),
});
export type DeliveryQuote = z.infer<typeof DeliveryQuoteSchema>;

/**
 * Checkout
 *
 * `createOrder` accepts an `OrderContext` (the canonical Sevana order shape)
 * and returns a retailer-specific confirmation containing a pay link. The pay
 * link is the only way the customer is asked for money — Sevana never handles
 * payment directly.
 */
export const OrderConfirmationSchema = z.object({
  retailerOrderRef: z.string().min(1),
  payLink: z.string().url(),
  currency: CurrencyCodeSchema,
  expectedTotal: MoneySchema,
});
export type OrderConfirmation = z.infer<typeof OrderConfirmationSchema>;

export const OrderTrackingStepSchema = z.object({
  status: z.string(),
  at: z.string().datetime(),
  notes: z.string().optional(),
});
export type OrderTrackingStep = z.infer<typeof OrderTrackingStepSchema>;

export const OrderTrackingSchema = z.object({
  retailerOrderRef: z.string(),
  currentStatus: z.string(),
  timeline: z.array(OrderTrackingStepSchema).default([]),
  payLink: z.string().url().optional(),
});
export type OrderTracking = z.infer<typeof OrderTrackingSchema>;

/**
 * CRM (optional)
 *
 * `findCustomer` resolves an external identity (email, phone, retailer-side
 * id) into a profile snapshot for personalisation; `upsertProfile` syncs the
 * Sevana-side profile back to the retailer's CRM where consented.
 */
export const CustomerLookupSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  retailerCustomerId: z.string().optional(),
});
export type CustomerLookup = z.infer<typeof CustomerLookupSchema>;

export const CrmCustomerSnapshotSchema = z.object({
  retailerCustomerId: z.string(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  attributes: z.record(z.string()).default({}),
});
export type CrmCustomerSnapshot = z.infer<typeof CrmCustomerSnapshotSchema>;
