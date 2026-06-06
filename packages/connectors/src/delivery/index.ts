import type {
  DeliveryCity,
  DeliveryQuote,
  DeliveryQuoteLine,
} from "../types/index.js";

/**
 * Delivery connector.
 *
 * The Logistics agent uses this to resolve free-text destinations (including
 * vernacular Sinhala/Tamil names) and to validate that a chosen delivery date
 * is achievable for the items in the cart.
 */
export interface DeliveryConnector {
  readonly kind: "delivery";
  readonly adapter: string;

  /**
   * List every destination the retailer currently delivers to, with any
   * vernacular aliases. Used by the Logistics agent to canonicalise the
   * customer's free-text destination.
   */
  listDeliveryCities(): Promise<DeliveryCity[]>;

  /**
   * Check whether a given basket can be delivered to a city on a given date.
   *
   * @param city   City id (preferred) or canonical name. The connector is
   *               responsible for resolving aliases if it accepts a name.
   * @param date   Requested delivery date (ISO 8601). The connector returns
   *               the earliest feasible date if the requested date is not
   *               achievable.
   * @param items  The line items being delivered (used for perishability
   *               checks — cakes, flowers, frozen goods).
   * @returns      A quote with availability, earliest achievable date, fee,
   *               perishable warnings, and an optional human-readable reason
   *               if the request was refused.
   */
  checkDelivery(
    city: string,
    date: string,
    items: DeliveryQuoteLine[],
  ): Promise<DeliveryQuote>;
}
