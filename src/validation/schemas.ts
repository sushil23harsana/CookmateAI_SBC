import { z } from 'zod';
import { ValidationError } from '../errors.js';

/**
 * Zod schemas for every tool boundary. LLM-generated arguments are untrusted
 * input; we validate them here so malformed calls become recoverable tool errors
 * (the model fixes and retries) instead of runtime crashes.
 */

export const CandidateSchema = z.object({
  id: z.string().default(''),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  ingredient: z.string().default(''),
  essential: z.boolean(),
});

export const SearchItemsInput = z.object({
  query: z.string().min(1, 'query is required'),
  max_results: z.coerce.number().int().min(1).max(20).default(5),
});

export const OptimizeBudgetInput = z.object({
  candidates: z.array(CandidateSchema).min(1, 'at least one candidate is required'),
  budget: z.number().positive('budget must be > 0'),
  fees: z.number().nonnegative().optional(),
});

export const ReviewCartInput = z.object({
  sku_ids: z.array(z.string().min(1)).min(1, 'at least one sku_id is required'),
});

export const PlaceOrderInput = z.object({
  cart_id: z.string().min(1, 'cart_id from review_cart is required'),
});

export const TrackOrderInput = z.object({
  order_id: z.string().min(1),
});

export const AddToPantryInput = z.object({
  items: z.array(z.string().min(1)).min(1),
});

/** Tolerant normalizer for provider search results of unknown shape. */
export const SkuSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().optional(),
  price: z.coerce.number().nonnegative(),
  packSize: z.string().optional(),
  inStock: z.boolean().default(true),
});

/** Parse `input` against `schema`, throwing a ValidationError with a readable message. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid ${what}: ${msg}`);
  }
  return r.data;
}
