import { config } from '../config.js';
import { logger } from '../logger.js';
import { CookmateError } from '../errors.js';
import { fitBudget } from '../core/budget.js';
import { computeCart, assertWithinSpendLimit, cartSkuIds, CartStore } from '../core/cart.js';
import { FilePantry, type PantryStore } from '../core/pantry.js';
import type { InstamartProvider } from '../instamart/provider.js';
import type { Candidate, Cart, OrderResult, ToolDef, ToolResult } from '../types.js';
import {
  AddToPantryInput,
  OptimizeBudgetInput,
  PlaceOrderInput,
  ReviewCartInput,
  SearchItemsInput,
  TrackOrderInput,
  parseOrThrow,
} from '../validation/schemas.js';

/**
 * The tool-execution engine — channel-agnostic. The CLI (and later the web/
 * WhatsApp adapters) inject I/O via the deps; the safety layer (validation, cart
 * binding, spend cap, idempotency, confirm gate) lives here and always applies.
 */
export interface ExecutorDeps {
  provider: InstamartProvider;
  carts: CartStore;
  /** Ask the human to confirm a specific cart. Return true to place the order. */
  confirmOrder: (cart: Cart) => Promise<boolean>;
  /** Side-channel notification for a successful placement (UI / logging). */
  onOrderPlaced?: (order: OrderResult, cart: Cart) => void;
  /** Fired whenever a cart is (re)computed — lets the web UI stream a rich card. */
  onCartReviewed?: (cart: Cart) => void;
  /** Pantry store (per-user). Defaults to the file-backed pantry for the CLI. */
  pantry?: PantryStore;
  deliveryFee?: number;
  minOrderValue?: number;
  maxOrderValue?: number;
}

/** All model-facing tools are declared here, so the safety layer is never bypassed. */
export function toolDefs(): ToolDef[] {
  return [
    {
      name: 'search_items',
      description:
        'Search Instamart for purchasable SKUs by keyword (ingredient, brand, or category) at the delivery location. Returns id, name, brand, price (₹), pack size, stock.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Ingredient / product / brand, e.g. "whole wheat pasta"' },
          max_results: { type: 'integer', description: 'Max SKUs (1-20, default 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'optimize_budget',
      description:
        'Fit the best basket inside a rupee budget. Pass candidate SKUs (one per ingredient) each tagged essential vs optional; returns which to keep, which to trim, and the total. Use for any budget-capped request instead of doing the math yourself.',
      input_schema: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                price: { type: 'number' },
                ingredient: { type: 'string' },
                essential: { type: 'boolean' },
              },
              required: ['name', 'price', 'essential'],
            },
          },
          budget: { type: 'number', description: 'Total budget in ₹ (incl. fees)' },
          fees: { type: 'number', description: `Delivery fee in ₹ (default ${config.deliveryFee})` },
        },
        required: ['candidates', 'budget'],
      },
    },
    {
      name: 'review_cart',
      description:
        'Build the AUTHORITATIVE cart from sku_ids: real prices, line items, total incl. delivery fee, a belowMinOrderValue flag, and a cart_id. Always call this before presenting totals or ordering. Present these numbers verbatim.',
      input_schema: {
        type: 'object',
        properties: { sku_ids: { type: 'array', items: { type: 'string' } } },
        required: ['sku_ids'],
      },
    },
    {
      name: 'place_order',
      description:
        'Place the order for a reviewed cart. Requires the cart_id returned by review_cart. Spends real money — the user is asked to confirm and a max-order-value cap is enforced.',
      input_schema: {
        type: 'object',
        properties: { cart_id: { type: 'string' } },
        required: ['cart_id'],
      },
    },
    {
      name: 'track_order',
      description: 'Get the current status of a placed order by its order id.',
      input_schema: {
        type: 'object',
        properties: { order_id: { type: 'string' } },
        required: ['order_id'],
      },
    },
    {
      name: 'get_pantry',
      description: 'List ingredients the user already has, so you do not add them to the cart.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'add_to_pantry',
      description: 'Remember that the user already has these ingredients, for future orders.',
      input_schema: {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'string' } } },
        required: ['items'],
      },
    },
  ];
}

export type Executor = (name: string, input: Record<string, unknown>) => Promise<ToolResult>;

export function createExecutor(deps: ExecutorDeps): Executor {
  const { provider, carts } = deps;
  const pantry = deps.pantry ?? new FilePantry();
  const deliveryFee = deps.deliveryFee ?? config.deliveryFee;
  const minOrderValue = deps.minOrderValue ?? config.minOrderValue;
  const maxOrderValue = deps.maxOrderValue ?? config.maxOrderValue;
  const placedByCart = new Map<string, OrderResult>(); // idempotency: one order per cart

  async function dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'search_items': {
        const { query, max_results } = parseOrThrow(SearchItemsInput, input, 'search_items');
        return JSON.stringify({ query, results: await provider.searchItems(query, max_results) });
      }
      case 'optimize_budget': {
        const { candidates, budget, fees } = parseOrThrow(OptimizeBudgetInput, input, 'optimize_budget');
        return JSON.stringify(fitBudget(candidates as Candidate[], budget, fees ?? deliveryFee));
      }
      case 'get_pantry':
        return JSON.stringify({ pantry: pantry.get() });
      case 'add_to_pantry': {
        const { items } = parseOrThrow(AddToPantryInput, input, 'add_to_pantry');
        return JSON.stringify({ pantry: pantry.add(items) });
      }
      case 'review_cart': {
        const { sku_ids } = parseOrThrow(ReviewCartInput, input, 'review_cart');
        const items = await provider.getItems(sku_ids);
        const found = new Set(items.map((i) => i.id));
        const missing = sku_ids.filter((id) => !found.has(id));
        const cart = computeCart(items, { deliveryFee, minOrderValue });
        carts.put(cart);
        deps.onCartReviewed?.(cart);
        return JSON.stringify({ cart, missing });
      }
      case 'track_order': {
        const { order_id } = parseOrThrow(TrackOrderInput, input, 'track_order');
        return JSON.stringify(await provider.trackOrder(order_id));
      }
      case 'place_order': {
        const { cart_id } = parseOrThrow(PlaceOrderInput, input, 'place_order');
        const cart = carts.get(cart_id);
        if (!cart) {
          return JSON.stringify({
            placed: false,
            error: 'Unknown or expired cart_id. Call review_cart again to get a fresh one.',
          });
        }
        const already = placedByCart.get(cart_id);
        if (already) return JSON.stringify({ placed: true, idempotentReplay: true, order: already });

        assertWithinSpendLimit(cart, maxOrderValue); // throws SpendLimitError -> tool error

        const ok = await deps.confirmOrder(cart);
        if (!ok) return JSON.stringify({ placed: false, reason: 'User declined at the confirm gate.' });

        const order = await provider.placeOrder(cartSkuIds(cart), cart.total, cart.cartId);
        placedByCart.set(cart_id, order);
        deps.onOrderPlaced?.(order, cart);
        logger.info('order placed', { orderId: order.orderId, total: cart.total });
        return JSON.stringify({ placed: true, order });
      }
      default:
        return JSON.stringify({ error: `unknown tool ${name}` });
    }
  }

  // Wrap so tool failures become recoverable tool_results, not crashes.
  return async function execute(name, input): Promise<ToolResult> {
    try {
      return { result: await dispatch(name, input) };
    } catch (err) {
      if (err instanceof CookmateError) {
        logger.warn(`tool ${name} failed`, { code: err.code, message: err.message });
        return { result: JSON.stringify({ error: err.message, code: err.code }), isError: true };
      }
      logger.error(`tool ${name} crashed`, err);
      return { result: JSON.stringify({ error: 'internal error executing tool' }), isError: true };
    }
  };
}
