import assert from 'node:assert/strict';
import { fitBudget } from './budget.js';
import type { Candidate } from '../types.js';

const c = (name: string, price: number, essential: boolean, id = name): Candidate => ({
  id,
  name,
  price,
  ingredient: name,
  essential,
});

// 1) Everything fits -> nothing trimmed.
{
  const r = fitBudget([c('pasta', 99, true), c('sauce', 120, true), c('basil', 30, false)], 500, 35);
  assert.equal(r.feasible, true);
  assert.equal(r.trimmed.length, 0);
  assert.equal(r.total, 99 + 120 + 30 + 35);
}

// 2) Essentials alone exceed budget -> infeasible, honest floor.
{
  const r = fitBudget([c('pasta', 99, true), c('sauce', 120, true)], 150, 35);
  assert.equal(r.feasible, false);
  assert.equal(r.essentialFloor, 99 + 120 + 35);
  assert.equal(r.selected.length, 2);
}

// 3) Cheapest optionals fit first; pricier ones trimmed.
{
  const r = fitBudget(
    [c('pasta', 99, true), c('cheese', 220, false), c('basil', 30, false), c('olives', 150, false)],
    300,
    35,
  );
  assert.equal(r.feasible, true);
  assert.ok(r.selected.some((s) => s.name === 'basil'));
  assert.ok(r.total <= 300);
}

// 4) Hardening: NaN / negative prices are dropped, duplicates de-duped.
{
  const r = fitBudget(
    [
      c('pasta', 99, true),
      c('bad', Number.NaN, false),
      c('neg', -50, false),
      c('basil', 30, false, 'dup'),
      c('basil-again', 30, false, 'dup'),
    ],
    400,
    35,
  );
  assert.ok(!r.selected.some((s) => s.name === 'bad' || s.name === 'neg'));
  // only one of the duplicate-id basils is kept
  assert.equal(r.selected.filter((s) => s.id === 'dup').length, 1);
}

// 5) Empty candidates -> feasible with just the fee.
{
  const r = fitBudget([], 200, 35);
  assert.equal(r.feasible, true);
  assert.equal(r.total, 35);
  assert.equal(r.selected.length, 0);
}

// 6) Exact-fit boundary is inclusive, even with float-hostile prices.
//    33.33×3 + 0.01 + 35 = 135.00 exactly; naive float sums say 135.00000000000003
//    and would wrongly trim the last item.
{
  const r = fitBudget(
    [c('x', 33.33, true), c('y', 33.33, true), c('z', 33.33, true), c('w', 0.01, false)],
    135,
    35,
  );
  assert.equal(r.feasible, true);
  assert.equal(r.trimmed.length, 0);
  assert.equal(r.total, 135);
}

// 7) Budget exactly equal to essentials + fees is feasible (boundary is inclusive).
{
  const r = fitBudget([c('pasta', 99, true)], 134, 35);
  assert.equal(r.feasible, true);
  assert.equal(r.total, 134);
}

// 8) Zero / NaN budget with essentials -> infeasible, never a crash.
{
  assert.equal(fitBudget([c('pasta', 99, true)], 0, 35).feasible, false);
  assert.equal(fitBudget([c('pasta', 99, true)], Number.NaN, 35).feasible, false);
}

// 9) Free (₹0) optionals always fit once essentials do.
{
  const r = fitBudget([c('pasta', 99, true), c('coupon-sachet', 0, false)], 134, 35);
  assert.equal(r.feasible, true);
  assert.ok(r.selected.some((s) => s.name === 'coupon-sachet'));
}

console.log('✓ budget optimizer tests passed');
