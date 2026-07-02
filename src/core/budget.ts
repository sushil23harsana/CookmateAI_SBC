import type { Candidate, BudgetResult } from '../types.js';

/**
 * Deterministic budget optimizer — the part we deliberately keep OUT of the LLM.
 *
 * Contract:
 *   - The model picks candidate SKUs (one per ingredient) and tags each
 *     essential (pasta, sauce base) vs optional (parmesan, garnish).
 *   - This function does the money math: all essentials must be in; optionals
 *     are added by value-per-rupee until the cap (incl. fees) is hit.
 *
 * value-per-rupee proxy: with no nutrition/value signal in Phase 0 we add the
 * cheapest optionals first, which maximizes how many extras fit under the cap.
 * Swap in a real value score here once search results carry one.
 */
export function fitBudget(candidates: Candidate[], budget: number, fees: number): BudgetResult {
  const safeFees = Number.isFinite(fees) && fees >= 0 ? fees : 0;
  const safeBudget = Number.isFinite(budget) && budget > 0 ? budget : 0;
  const clean = sanitize(candidates);

  // All comparisons happen in integer PAISE — float sums (99.99 + 0.01 style)
  // must never decide whether an item fits at the budget boundary.
  const paise = (n: number) => Math.round(n * 100);
  const feesP = paise(safeFees);
  const budgetP = paise(safeBudget);

  const essentials = clean.filter((c) => c.essential);
  const optionals = clean.filter((c) => !c.essential).sort((a, b) => a.price - b.price);

  const essentialP = essentials.reduce((s, c) => s + paise(c.price), 0);
  const essentialFloor = (essentialP + feesP) / 100;

  // Case 1: essentials alone blow the budget -> be honest about the floor.
  if (essentialP + feesP > budgetP) {
    return {
      feasible: false,
      budget: safeBudget,
      fees: safeFees,
      essentialFloor,
      selected: essentials,
      trimmed: optionals,
      itemsTotal: essentialP / 100,
      total: essentialFloor,
      message:
        `Can't make this within ₹${safeBudget}. The essentials alone come to ` +
        `₹${essentialP / 100} + ₹${safeFees} fees = ₹${essentialFloor}. ` +
        `Offer the user: fewer servings, cheaper SKUs, or a simpler version.`,
    };
  }

  // Case 2: fit optionals greedily under the remaining headroom.
  const selected: Candidate[] = [...essentials];
  const trimmed: Candidate[] = [];
  let runningP = essentialP;

  for (const opt of optionals) {
    const priceP = paise(opt.price);
    if (runningP + priceP + feesP <= budgetP) {
      selected.push(opt);
      runningP += priceP;
    } else {
      trimmed.push(opt);
    }
  }

  const itemsTotal = runningP / 100;
  const total = (runningP + feesP) / 100;
  const message =
    trimmed.length === 0
      ? `Everything fits: ${selected.length} items, ₹${total} incl. ₹${safeFees} fees.`
      : `In ₹${safeBudget}: ${selected.length} items (₹${total} incl. fees). ` +
        `Trimmed to fit: ${trimmed.map((t) => t.name).join(', ')} ` +
        `(+₹${round(sum(trimmed.map((t) => t.price)))} to add back).`;

  return {
    feasible: true,
    budget: safeBudget,
    fees: safeFees,
    essentialFloor,
    selected,
    trimmed,
    itemsTotal,
    total,
    message,
  };
}

/** Drop non-finite/negative prices and de-duplicate by id (keep first seen). */
function sanitize(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (!c || typeof c.price !== 'number' || !Number.isFinite(c.price) || c.price < 0) continue;
    const key = c.id || c.name;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(c);
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (n: number) => Math.round(n * 100) / 100;
