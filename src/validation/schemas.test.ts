import assert from 'node:assert/strict';
import { parseOrThrow, SearchItemsInput, PlaceOrderInput, ReviewCartInput, SkuSchema } from './schemas.js';
import { ValidationError } from '../errors.js';

// 1) Valid search input with default max_results.
{
  const r = parseOrThrow(SearchItemsInput, { query: 'pasta' }, 'search_items');
  assert.equal(r.query, 'pasta');
  assert.equal(r.max_results, 5);
}

// 2) Empty query is rejected with a ValidationError.
{
  assert.throws(() => parseOrThrow(SearchItemsInput, { query: '' }, 'search_items'), ValidationError);
}

// 3) place_order requires a cart_id.
{
  assert.throws(() => parseOrThrow(PlaceOrderInput, {}, 'place_order'), ValidationError);
  assert.equal(parseOrThrow(PlaceOrderInput, { cart_id: 'cart_abc' }, 'place_order').cart_id, 'cart_abc');
}

// 4) review_cart needs a non-empty sku_ids array.
{
  assert.throws(() => parseOrThrow(ReviewCartInput, { sku_ids: [] }, 'review_cart'), ValidationError);
}

// 5) SkuSchema coerces a string price and defaults inStock.
{
  const r = parseOrThrow(SkuSchema, { id: 'x', name: 'X', price: '99' }, 'sku');
  assert.equal(r.price, 99);
  assert.equal(r.inStock, true);
}

console.log('✓ validation schema tests passed');
