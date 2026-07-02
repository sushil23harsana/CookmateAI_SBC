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
}

export interface OrderResult {
  orderId: string;
  status: string;
  etaMinutes?: number;
  total?: number;
  raw?: unknown;
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
