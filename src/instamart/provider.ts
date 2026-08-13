import type {
  Sku,
  OrderResult,
  TrackResult,
  PaymentChoice,
  PaymentOptions,
  PaymentStatus,
  ProviderBill,
} from '../types.js';

/**
 * An InstamartProvider is the swappable boundary between the agent and the
 * grocery backend, exposed as SEMANTIC operations (not raw MCP tool passthrough).
 *
 * Why semantic, not passthrough: the harness owns the tool schemas and the safety
 * layer (cart binding, spend cap, idempotency, confirm gate). The model can never
 * call a raw "place order" tool directly — it goes through our gated wrapper.
 *
 * The same recipe -> cart -> order flow therefore runs identically against the
 * mock and the live Swiggy MCP; only these four methods differ.
 */
export interface InstamartProvider {
  readonly name: string;

  /** Search for purchasable SKUs at the delivery location. */
  searchItems(query: string, maxResults: number): Promise<Sku[]>;

  /** Fetch authoritative current data for specific SKU ids (prices the cart trusts). */
  getItems(ids: string[]): Promise<Sku[]>;

  /**
   * Place an order. MUST only be called by the gated wrapper after confirmation.
   * With a UPI payment choice the result may be pendingPayment — the user then
   * approves in their own UPI app and status is polled via checkPaymentStatus.
   */
  placeOrder(
    skuIds: string[],
    total: number,
    idempotencyKey: string,
    payment?: PaymentChoice,
  ): Promise<OrderResult>;

  /** Current status of a placed order. */
  trackOrder(orderId: string): Promise<TrackResult>;

  /**
   * The provider's authoritative bill for the cart priced by the LAST getItems
   * call (delivery fee, taxes, discounts, final to-pay). Optional — providers
   * without a server-side bill let the engine compute fees itself.
   */
  lastBill?(): ProviderBill | undefined;

  /** Payment methods for the current cart (optional — COD-only providers omit it). */
  getPaymentOptions?(): Promise<PaymentOptions>;

  /** One gentle status read for an in-flight UPI payment (server long-polls). */
  checkPaymentStatus?(paasId: string, orderId?: string): Promise<PaymentStatus>;

  /** Poll-timeout fallback: finalize a PAID order stuck in PENDING_PAYMENT. Idempotent. */
  confirmPendingOrder?(orderId: string, paasId: string): Promise<PaymentStatus>;

  close(): Promise<void>;
}
