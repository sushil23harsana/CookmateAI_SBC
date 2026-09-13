import assert from 'node:assert/strict';
import { createExecutor } from './executor.js';
import { CartStore } from '../core/cart.js';
import type { InstamartProvider } from '../instamart/provider.js';
import type { Sku, OrderResult, TrackResult } from '../types.js';

class FakeProvider implements InstamartProvider {
  readonly name = 'fake';
  placeCount = 0;
  private catalog: Record<string, Sku> = {
    a: { id: 'a', name: 'A', price: 100, inStock: true },
    b: { id: 'b', name: 'B', price: 50, inStock: true },
    big: { id: 'big', name: 'Big', price: 6000, inStock: true },
  };
  async searchItems(_q: string, max: number): Promise<Sku[]> {
    return Object.values(this.catalog).slice(0, max);
  }
  async getItems(ids: string[]): Promise<Sku[]> {
    return ids.map((id) => this.catalog[id]).filter(Boolean);
  }
  async placeOrder(_skuIds: string[], total: number, key: string): Promise<OrderResult> {
    this.placeCount++;
    return { orderId: 'ORD-' + key.slice(-4), status: 'CONFIRMED', total };
  }
  async trackOrder(orderId: string): Promise<TrackResult> {
    return { orderId, status: 'PACKING' };
  }
  async close(): Promise<void> {}
}

const base = { deliveryFee: 35, minOrderValue: 99, maxOrderValue: 5000 };
const json = (r: { result: string }) => JSON.parse(r.result);
async function review(execute: ReturnType<typeof createExecutor>, ids: string[]) {
  return json(await execute('review_cart', { sku_ids: ids })).cart;
}

// 1) Happy path + harness idempotency: same cart never orders twice.
{
  const provider = new FakeProvider();
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const cart = await review(execute, ['a', 'b']);
  assert.equal(cart.total, 185);

  const r1 = json(await execute('place_order', { cart_id: cart.cartId }));
  assert.equal(r1.placed, true);
  assert.ok(r1.order.orderId);

  const r2 = json(await execute('place_order', { cart_id: cart.cartId }));
  assert.equal(r2.idempotentReplay, true);
  assert.equal(provider.placeCount, 1); // placed exactly once
}

// 2) Unknown / expired cart_id is rejected, never placed.
{
  const provider = new FakeProvider();
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const r = json(await execute('place_order', { cart_id: 'cart_nope' }));
  assert.equal(r.placed, false);
  assert.match(r.error, /Unknown or expired/);
  assert.equal(provider.placeCount, 0);
}

// 3) Declining at the confirm gate places nothing.
{
  const provider = new FakeProvider();
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => false,
    ...base,
  });
  const cart = await review(execute, ['a']);
  const r = json(await execute('place_order', { cart_id: cart.cartId }));
  assert.equal(r.placed, false);
  assert.equal(provider.placeCount, 0);
}

// 4) Spend cap blocks an over-limit cart before any order.
{
  const provider = new FakeProvider();
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    deliveryFee: 35,
    minOrderValue: 99,
    maxOrderValue: 100,
  });
  const cart = await review(execute, ['big']);
  const res = await execute('place_order', { cart_id: cart.cartId });
  assert.equal(res.isError, true);
  assert.equal(json(res).code, 'SPEND_LIMIT');
  assert.equal(provider.placeCount, 0);
}

// 5) Malformed tool input becomes a recoverable validation error.
{
  const provider = new FakeProvider();
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const res = await execute('place_order', {});
  assert.equal(res.isError, true);
  assert.equal(json(res).code, 'VALIDATION');
}

// 6) A new review retires older baskets, even when the items are identical.
{
  const provider = new FakeProvider();
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const c1 = await review(execute, ['a']);
  const c2 = await review(execute, ['a']);
  assert.notEqual(c1.cartId, c2.cartId);
  assert.equal(json(await execute('place_order', { cart_id: c1.cartId })).placed, false);
  assert.equal(json(await execute('place_order', { cart_id: c2.cartId })).placed, true);
  assert.equal(provider.placeCount, 1);
}

// 7) The confirm gate receives the exact cart being placed (cart-bound gates
//    depend on this), and a mismatched binding places nothing.
{
  const provider = new FakeProvider();
  let armedCartId: string | undefined;
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async (cart) => {
      const armed = armedCartId;
      armedCartId = undefined; // one-shot
      return armed === cart.cartId;
    },
    ...base,
  });
  const cart = await review(execute, ['a']);
  // Gate armed for a DIFFERENT cart -> declined, nothing placed.
  armedCartId = 'cart_someoneelse';
  assert.equal(json(await execute('place_order', { cart_id: cart.cartId })).placed, false);
  assert.equal(provider.placeCount, 0);
  // Gate armed for THIS cart -> placed.
  armedCartId = cart.cartId;
  assert.equal(json(await execute('place_order', { cart_id: cart.cartId })).placed, true);
  assert.equal(provider.placeCount, 1);
}

// 8) A repeated sku_id means qty > 1, even when the provider dedupes ids
//    (the real catalog providers return one item per unique id).
{
  const provider = new FakeProvider();
  const dedupingGetItems = provider.getItems.bind(provider);
  provider.getItems = async (ids: string[]) => dedupingGetItems([...new Set(ids)]);
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const cart = await review(execute, ['a', 'a', 'b']);
  const lineA = cart.lines.find((l: { id: string }) => l.id === 'a');
  assert.equal(lineA.qty, 2);
  assert.equal(cart.total, 285); // 2×100 + 50 + 35 delivery
}

console.log('✓ executor (order safety) tests passed');

// The live bill must be calculated for the full quantity, not deduplicated ids.
{
  const provider = new FakeProvider();
  let bill = 0;
  const original = provider.getItems.bind(provider);
  provider.getItems = async (ids) => {
    const items = await original(ids);
    bill = items.reduce((sum, item) => sum + item.price, 0) + 35;
    return [...new Map(items.map((item) => [item.id, item])).values()];
  };
  const execute = createExecutor({
    provider: Object.assign(provider, { lastBill: () => ({ toPay: bill, lines: [] }) }),
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const cart = await review(execute, ['a', 'a']);
  assert.equal(cart.itemsTotal, 200);
  assert.equal(cart.total, 235);
}

// Two simultaneous confirmations cannot both reach the provider.
{
  const provider = new FakeProvider();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = provider.placeOrder.bind(provider);
  provider.placeOrder = async (...args) => {
    await gate;
    return original(...args);
  };
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const cart = await review(execute, ['a']);
  const first = execute('place_order', { cart_id: cart.cartId });
  const second = json(await execute('place_order', { cart_id: cart.cartId }));
  assert.equal(second.placed, false);
  release();
  assert.equal(json(await first).placed, true);
  assert.equal(provider.placeCount, 1);
}

// An uncertain provider outcome must not be blindly submitted again.
{
  const provider = new FakeProvider();
  provider.placeOrder = async () => {
    provider.placeCount++;
    throw new Error('connection lost');
  };
  const execute = createExecutor({
    provider,
    carts: new CartStore(),
    confirmOrder: async () => true,
    ...base,
  });
  const cart = await review(execute, ['a']);
  await execute('place_order', { cart_id: cart.cartId });
  const second = json(await execute('place_order', { cart_id: cart.cartId }));
  assert.equal(second.placed, false);
  assert.equal(provider.placeCount, 1);
}

console.log('✓ quantity, stale basket and concurrent checkout regressions passed');
