import { z } from "zod";
import {
  CurrencyCodeSchema,
  MoneySchema,
  OrderIdSchema,
  ProductIdSchema,
  SessionIdSchema,
  TenantIdSchema,
} from "./primitives.js";

export const DeliveryDestinationSchema = z.object({
  rawText: z.string(),
  resolvedCity: z.string().optional(),
  postalCode: z.string().optional(),
  notes: z.string().optional(),
});
export type DeliveryDestination = z.infer<typeof DeliveryDestinationSchema>;

export const OrderLineSchema = z.object({
  productId: ProductIdSchema,
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

export const SenderSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});
export type Sender = z.infer<typeof SenderSchema>;

export const RecipientSchema = z.object({
  name: z.string(),
  phone: z.string().optional(),
  destination: DeliveryDestinationSchema,
});
export type Recipient = z.infer<typeof RecipientSchema>;

export const OrderStatusSchema = z.enum([
  "draft",
  "awaiting-payment",
  "paid",
  "fulfilling",
  "delivered",
  "cancelled",
  "failed",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderContextSchema = z.object({
  id: OrderIdSchema,
  tenantId: TenantIdSchema,
  sessionId: SessionIdSchema,
  sender: SenderSchema,
  recipients: z.array(RecipientSchema).min(1),
  lines: z.array(OrderLineSchema).min(1),
  currency: CurrencyCodeSchema,
  total: MoneySchema,
  deliveryDate: z.string().datetime().optional(),
  giftMessage: z.string().optional(),
  status: OrderStatusSchema,
  payLink: z.string().url().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrderContext = z.infer<typeof OrderContextSchema>;
