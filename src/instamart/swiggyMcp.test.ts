import assert from 'node:assert/strict';
import { SwiggyInstamartProvider } from './swiggyMcp.js';

const provider = new SwiggyInstamartProvider(
  () => 'synthetic',
  () => 'home',
);
let payable: number | undefined = 235;
let checkoutCalls = 0;
let malformedOrder = false;
let updated: unknown;
const intercepted = provider as unknown as {
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};
intercepted.call = async (name, args) => {
  if (name === 'get_addresses') return [{ id: 'home' }];
  if (name === 'update_cart') {
    updated = args.items;
    return {};
  }
  if (name === 'get_cart')
    return { items: [{ id: 'a', name: 'Paneer', price: 100, inStock: true }], cartTotalAmount: payable };
  if (name === 'checkout') {
    checkoutCalls++;
    return malformedOrder ? {} : { orderId: 'SYNTHETIC-1', status: 'CONFIRMED' };
  }
  throw new Error(`Unexpected synthetic tool: ${name}`);
};

await provider.getItems(['a', 'a']);
assert.deepEqual(updated, [{ spinId: 'a', quantity: 2 }]);
assert.equal(provider.lastBill()?.toPay, 235);
const placed = await provider.placeOrder(['a', 'a'], 235, 'test-cart');
assert.equal(placed.orderId, 'SYNTHETIC-1');
assert.equal(checkoutCalls, 1);

payable = 245;
await assert.rejects(provider.placeOrder(['a', 'a'], 235, 'test-cart'), /payable total changed/);
assert.equal(checkoutCalls, 1, 'a changed quote must not reach checkout');
payable = undefined;
await assert.rejects(provider.getItems(['a']), /did not return a payable total/);
payable = 235;
malformedOrder = true;
await assert.rejects(provider.placeOrder(['a', 'a'], 235, 'test-cart'), /did not confirm the result/);
assert.equal(checkoutCalls, 2, 'ambiguous checkout is never retried or assigned a fake order id');
console.log('✓ Swiggy quantity, fresh bill, missing bill and ambiguous order regressions passed');
