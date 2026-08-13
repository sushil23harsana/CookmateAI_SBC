// Shared domain types for the Cookmate core engine.

/** A real purchasable SKU as returned by an Instamart search. */
export interface Sku {
  id: string;
  name: string;
  brand?: string;
  price: number; // rupees, the pack price
  packSize?: string; // e.g. "500 g", "250 ml"
  inStock: boolean;
}

/**
 * A budget candidate: one chosen SKU mapped to a recipe ingredient,
 * tagged essential (must-have) vs optional (nice-to-have).
 * This is the structured input the deterministic optimizer consumes.
 */
export interface Candidate {
  id: string;
  name: string;
  price: number;
  ingredient: string;
  essential: boolean;
}

export interface BudgetResult {
  feasible: boolean;
  budget: number;
  fees: number;
  essentialFloor: number; // cheapest possible essentials + fees
  selected: Candidate[];
  trimmed: Candidate[]; // optionals that did not fit
  itemsTotal: number;
  total: number; // itemsTotal + fees
  message: string;
}

/** One line in a server-computed cart (authoritative — never model-supplied). */
export interface CartLine {
  id: string;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
}

/** A canonical cart. `cartId` binds a confirmation to exact contents + total. */
export interface Cart {
  cartId: string;
  lines: CartLine[];
  itemsTotal: number;
  fees: number;
  total: number;
  minOrderValue: number;
  belowMinOrderValue: boolean;
  createdAt: number;
  /** The provider's own bill breakdown (delivery/GST/discounts), when it gave one. */
  bill?: Array<{ label: string; amount: number }>;
}

/** A provider's authoritative bill for the current server-side cart. */
export interface ProviderBill {
  /** The exact amount the user will pay, per the provider. */
  toPay?: number;
  lines: Array<{ label: string; amount: number }>;
}

export interface OrderResult {
  orderId: string;
  status: string;
  etaMinutes?: number;
  total?: number;
  raw?: unknown;
  /** UPI: order created but awaiting the user's payment approval in their UPI app. */
  pendingPayment?: boolean;
  /** UPI: payment transaction id — required to poll status / confirm. */
  paasId?: string;
  /** UPI: deep link the user opens (mobile) or renders as a QR (desktop). */
  upiIntentUrl?: string;
  /** UPI: Swiggy's hosted payment page — the QR flow returns ONLY this (live 2026-08-13). */
  bridgeUrl?: string;
  pollingIntervalInMs?: number;
  maxTimeToPollForInMs?: number;
}

/** How the user chose to pay at the confirm gate. COD when omitted. */
export interface PaymentChoice {
  method: 'cod' | 'upi';
  /** UPI app id from PaymentOptions (mobile intent flow). */
  intentApp?: string;
  /** Desktop flow: ask for a QR instead of an app intent. */
  qr?: boolean;
}

export interface PaymentOptions {
  codAvailable: boolean;
  upiApps: Array<{ id: string; label: string }>;
  qrAvailable: boolean;
}

export interface PaymentStatus {
  /** success | paid | failed | refund-initiated | cancelled | cart_changed | pending */
  status: string;
  terminal: boolean;
  confirmed: boolean;
  orderStatus?: string;
}

export interface TrackResult {
  orderId: string;
  status: string;
  etaMinutes?: number;
  raw?: unknown;
}

/** Anthropic tool schema shape (name/description/input_schema). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Result of executing one tool call inside the agent loop. */
export interface ToolResult {
  result: string;
  isError?: boolean;
}
