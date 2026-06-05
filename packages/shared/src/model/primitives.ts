import { z } from "zod";

export const TenantIdSchema = z.string().min(1).brand<"TenantId">();
export type TenantId = z.infer<typeof TenantIdSchema>;

export const CustomerIdSchema = z.string().min(1).brand<"CustomerId">();
export type CustomerId = z.infer<typeof CustomerIdSchema>;

export const SessionIdSchema = z.string().min(1).brand<"SessionId">();
export type SessionId = z.infer<typeof SessionIdSchema>;

export const ProductIdSchema = z.string().min(1).brand<"ProductId">();
export type ProductId = z.infer<typeof ProductIdSchema>;

export const OrderIdSchema = z.string().min(1).brand<"OrderId">();
export type OrderId = z.infer<typeof OrderIdSchema>;

export const CurrencyCodeSchema = z.string().length(3).toUpperCase();
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const LocaleSchema = z.enum(["en", "si", "ta", "tanglish"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const ChannelSchema = z.enum([
  "widget",
  "full-page",
  "mobile-sdk",
  "messaging-whatsapp",
]);
export type Channel = z.infer<typeof ChannelSchema>;

export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: CurrencyCodeSchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const IsoDateTimeSchema = z.string().datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
