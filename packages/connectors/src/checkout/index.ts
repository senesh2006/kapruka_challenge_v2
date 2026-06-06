import type { OrderContext, OrderId } from "@sevana/shared";
import type { OrderConfirmation, OrderTracking } from "../types/index.js";

/**
 * Checkout connector.
 *
 * Sevana never handles payment directly. `createOrder` hands the canonical
 * `OrderContext` to the retailer's checkout, which returns a guest-checkout
 * pay link the customer follows to pay.
 */
export interface CheckoutConnector {
  readonly kind: "checkout";
  readonly adapter: string;

  /**
   * Create an order on the retailer's side and obtain a pay link.
   *
   * @param orderContext  The canonical Sevana order (recipients, lines,
   *                      currency, delivery date, gift message, total). The
   *                      caller MUST have obtained explicit customer
   *                      confirmation before calling this.
   * @returns             A confirmation containing the retailer's order
   *                      reference, the pay link, and the expected total
   *                      (in case the retailer applied taxes or fees).
   */
  createOrder(orderContext: OrderContext): Promise<OrderConfirmation>;

  /**
   * Look up the current status of an order by its retailer-side reference.
   *
   * @param id  Either the Sevana-side `OrderId` or the retailer's order
   *            reference — adapters MUST accept the retailer reference
   *            returned by `createOrder` and SHOULD accept the Sevana id if
   *            they can map it.
   */
  trackOrder(id: OrderId | string): Promise<OrderTracking>;
}
