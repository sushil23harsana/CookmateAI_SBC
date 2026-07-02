import type { Sku, OrderResult, TrackResult } from '../types.js';

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

  /** Place an order. MUST only be called by the gated wrapper after confirmation. */
  placeOrder(skuIds: string[], total: number, idempotencyKey: string): Promise<OrderResult>;

  /** Current status of a placed order. */
  trackOrder(orderId: string): Promise<TrackResult>;

  close(): Promise<void>;
}
