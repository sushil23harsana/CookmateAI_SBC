import { createHash, randomBytes } from 'node:crypto';
import type { Sku, Cart, CartLine } from '../types.js';
import { SpendLimitError } from '../errors.js';

export interface CartOptions {
  deliveryFee: number;
  minOrderValue: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Build a canonical cart from AUTHORITATIVE provider items (not model-supplied
 * prices). Duplicate SKUs collapse into a single line with qty.
 *
 * The cartId is an opaque hash of contents + a random nonce. Binding a
 * confirmation to exactly what was reviewed happens via the CartStore lookup
 * (id -> canonical cart), so the model can't show one cart and order another.
 * The nonce makes every review a DISTINCT confirmable cart: retrying one
 * confirmation replays idempotently (same cartId), while an intentional
 * "order the same again" gets a fresh cart that can actually be placed.
 */
export function computeCart(items: Sku[], opts: CartOptions): Cart {
  const byId = new Map<string, { sku: Sku; qty: number }>();
  for (const sku of items) {
    const existing = byId.get(sku.id);
    if (existing) existing.qty += 1;
    else byId.set(sku.id, { sku, qty: 1 });
  }

  const lines: CartLine[] = [...byId.values()].map(({ sku, qty }) => ({
    id: sku.id,
    name: sku.name,
    price: sku.price,
    qty,
    lineTotal: round(sku.price * qty),
  }));

  const itemsTotal = round(lines.reduce((s, l) => s + l.lineTotal, 0));
  const total = round(itemsTotal + opts.deliveryFee);

  const fingerprint = JSON.stringify({
    lines: lines.map((l) => [l.id, l.qty]).sort(),
    fees: opts.deliveryFee,
    total,
    nonce: randomBytes(8).toString('hex'),
  });
  const cartId = 'cart_' + createHash('sha256').update(fingerprint).digest('hex').slice(0, 12);

  return {
    cartId,
    lines,
    itemsTotal,
    fees: opts.deliveryFee,
    total,
    minOrderValue: opts.minOrderValue,
    belowMinOrderValue: itemsTotal < opts.minOrderValue,
    createdAt: Date.now(),
  };
}

/** Hard spend guardrail — throws before any order can be placed. */
export function assertWithinSpendLimit(cart: Cart, maxOrderValue: number): void {
  if (cart.total > maxOrderValue) {
    throw new SpendLimitError(
      `Cart total ₹${cart.total} exceeds the max order value of ₹${maxOrderValue}. ` +
        `Ask the user to confirm a higher limit or remove items.`,
    );
  }
}

/** Expand a cart's lines back into a flat SKU-id list (respecting qty). */
export function cartSkuIds(cart: Cart): string[] {
  return cart.lines.flatMap((l) => Array<string>(l.qty).fill(l.id));
}

/** Session-scoped store binding a cart id to its canonical contents. */
export class CartStore {
  private carts = new Map<string, Cart>();

  put(cart: Cart): void {
    this.carts.set(cart.cartId, cart);
  }

  get(cartId: string): Cart | undefined {
    return this.carts.get(cartId);
  }
}
