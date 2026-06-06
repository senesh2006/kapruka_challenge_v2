import type { CustomerProfile } from "@sevana/shared";
import type { CrmCustomerSnapshot, CustomerLookup } from "../types/index.js";

/**
 * CRM connector — optional.
 *
 * Retailers without a CRM bind nothing here; the Retention agent then keeps
 * the customer profile entirely inside Sevana. Where a CRM is present, this
 * adapter resolves authenticated identities and syncs consented profile
 * changes back.
 */
export interface CrmConnector {
  readonly kind: "crm";
  readonly adapter: string;

  /**
   * Look up a retailer-side customer by email, phone, or retailer id.
   *
   * @param lookup  At least one of `email`, `phone`, or `retailerCustomerId`
   *                must be provided.
   * @returns       A snapshot of the retailer's customer record, or `null`
   *                if no match.
   */
  findCustomer(lookup: CustomerLookup): Promise<CrmCustomerSnapshot | null>;

  /**
   * Push the Sevana-side `CustomerProfile` back to the retailer's CRM. The
   * caller is responsible for ensuring the customer's `consent` permits sync.
   *
   * @returns  The retailer-side snapshot after the upsert (may include a
   *           newly minted `retailerCustomerId`).
   */
  upsertProfile(profile: CustomerProfile): Promise<CrmCustomerSnapshot>;
}
