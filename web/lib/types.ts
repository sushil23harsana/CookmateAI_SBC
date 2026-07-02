// Client-safe mirrors of the engine's wire shapes (types only — no engine import).

export interface CartLine {
  id: string;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
}

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
}

export interface TrackResult {
  orderId: string;
  status: string;
  etaMinutes?: number;
}

export type Phase =
  | 'recipe'
  | 'pantry'
  | 'searching'
  | 'budget'
  | 'cart'
  | 'ordering'
  | 'tracking'
  | 'thinking';

export type Role = 'user' | 'assistant';

export interface ChatItem {
  id: string;
  kind: 'text' | 'cart' | 'order';
  role: Role;
  text?: string;
  cart?: Cart;
  ordered?: boolean;
  order?: OrderResult;
  /** True while assistant text is still streaming in (render raw + caret). */
  streaming?: boolean;
}
