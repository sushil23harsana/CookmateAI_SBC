import assert from 'node:assert/strict';
import { computeCart, assertWithinSpendLimit, cartSkuIds } from './cart.js';
import { SpendLimitError } from '../errors.js';
import type { Sku } from '../types.js';

const sku = (id: string, price: number, name = id): Sku => ({ id, name, price, inStock: true });
const opts = { deliveryFee: 35, minOrderValue: 99 };

// 1) Totals = items + fee; duplicate SKUs collapse into one line with qty.
{
  const cart = computeCart([sku('a', 100), sku('b', 50), sku('a', 100)], opts);
  assert.equal(cart.lines.length, 2);
  const lineA = cart.lines.find((l) => l.id === 'a')!;
  assert.equal(lineA.qty, 2);
  assert.equal(lineA.lineTotal, 200);
  assert.equal(cart.itemsTotal, 250);
  assert.equal(cart.total, 285);
}

// 2) belowMinOrderValue flag.
{
  const low = computeCart([sku('a', 40)], opts);
  assert.equal(low.belowMinOrderValue, true);
  const ok = computeCart([sku('a', 150)], opts);
  assert.equal(ok.belowMinOrderValue, false);
}

// 3) Every review gets a UNIQUE cartId — even for identical contents — so an
//    intentional reorder works. Binding to contents is via the CartStore lookup.
{
  const a1 = computeCart([sku('a', 100), sku('b', 50)], opts);
  const a2 = computeCart([sku('b', 50), sku('a', 100)], opts);
  assert.notEqual(a1.cartId, a2.cartId);
  assert.equal(a1.total, a2.total); // same money either way
}

// 4) Spend limit guard.
{
  const cart = computeCart([sku('a', 6000)], opts);
  assert.throws(() => assertWithinSpendLimit(cart, 5000), SpendLimitError);
  assert.doesNotThrow(() => assertWithinSpendLimit(cart, 7000));
}

// 5) cartSkuIds expands by qty.
{
  const cart = computeCart([sku('a', 10), sku('a', 10), sku('b', 10)], opts);
  const ids = cartSkuIds(cart).sort();
  assert.deepEqual(ids, ['a', 'a', 'b']);
}

console.log('✓ cart service tests passed');
