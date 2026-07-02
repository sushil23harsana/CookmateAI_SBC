import type { InstamartProvider } from './provider.js';
import type { Sku, OrderResult, TrackResult } from '../types.js';
import { logger } from '../logger.js';

/**
 * Mock Instamart provider — lets the entire pipeline run end-to-end today with
 * zero Swiggy credentials. Deterministic fake catalog + search + idempotent order.
 * Flip COOKMATE_PROVIDER=swiggy to run the identical flow against the real MCP.
 *
 * NOTE: every name is prefixed [DEMO] so fabricated prices can never be mistaken
 * for real Swiggy data in a recording.
 */

interface CatalogItem extends Sku {
  tags: string[];
}

const CATALOG: CatalogItem[] = [
  item('im-pasta-penne', 'Penne Pasta', 'Borges', 99, '500 g', ['pasta', 'penne', 'durum']),
  item('im-pasta-ww', 'Whole Wheat Fusilli', 'Disano', 140, '500 g', [
    'pasta',
    'whole wheat',
    'healthy',
    'fusilli',
  ]),
  item('im-passata', 'Tomato Pasta Sauce', 'Veeba', 120, '350 g', [
    'pasta sauce',
    'tomato',
    'passata',
    'marinara',
  ]),
  item('im-oliveoil', 'Extra Virgin Olive Oil', 'Figaro', 250, '250 ml', ['olive oil', 'oil']),
  item('im-garlic', 'Garlic', 'Fresho', 22, '100 g', ['garlic']),
  item('im-onion', 'Onion', 'Fresho', 39, '1 kg', ['onion']),
  item('im-tomato', 'Tomato', 'Fresho', 28, '500 g', ['tomato']),
  item('im-capsicum', 'Green Capsicum', 'Fresho', 40, '250 g', [
    'capsicum',
    'bell pepper',
    'pepper',
    'veggies',
  ]),
  item('im-broccoli', 'Broccoli', 'Fresho', 60, '250 g', ['broccoli', 'healthy', 'veggies']),
  item('im-mushroom', 'Button Mushroom', 'Fresho', 70, '200 g', ['mushroom', 'veggies']),
  item('im-cheese', 'Parmesan Cheese', 'Gowardhan', 220, '150 g', ['parmesan', 'cheese']),
  item('im-mozz', 'Mozzarella Cheese', 'Amul', 130, '200 g', ['mozzarella', 'cheese']),
  item('im-basil', 'Fresh Basil', 'Fresho', 30, '25 g', ['basil', 'herbs', 'garnish']),
  item('im-chiliflakes', 'Red Chilli Flakes', 'Keya', 80, '40 g', ['chilli flakes', 'seasoning', 'spice']),
  item('im-blackpepper', 'Black Pepper Powder', 'Catch', 60, '50 g', ['black pepper', 'pepper', 'spice']),
  item('im-salt', 'Iodised Salt', 'Tata', 28, '1 kg', ['salt']),
  item('im-chicken', 'Chicken Breast Boneless', 'Licious', 220, '450 g', ['chicken', 'non-veg', 'protein']),
  item('im-butter', 'Butter', 'Amul', 56, '100 g', ['butter']),
  item('im-cream', 'Fresh Cream', 'Amul', 75, '250 ml', ['cream', 'white sauce']),
  item('im-milk', 'Toned Milk', 'Amul', 34, '500 ml', ['milk']),
];

export class MockInstamartProvider implements InstamartProvider {
  readonly name = 'mock';

  // idempotencyKey -> the order it produced (so retries never double-order).
  private readonly placedByKey = new Map<string, OrderResult>();
  private readonly orders = new Map<string, { placedAt: number; total: number }>();

  async searchItems(query: string, maxResults: number): Promise<Sku[]> {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return CATALOG.map((it) => {
      const hay = `${it.name} ${it.brand ?? ''} ${it.tags.join(' ')}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { it, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.it.price - b.it.price)
      .slice(0, Math.max(1, maxResults))
      .map(({ it }) => toSku(it));
  }

  async getItems(ids: string[]): Promise<Sku[]> {
    const set = new Set(ids);
    return CATALOG.filter((it) => set.has(it.id)).map(toSku);
  }

  async placeOrder(skuIds: string[], total: number, idempotencyKey: string): Promise<OrderResult> {
    const cached = this.placedByKey.get(idempotencyKey);
    if (cached) {
      logger.info('idempotent replay — returning existing order', {
        idempotencyKey,
        orderId: cached.orderId,
      });
      return cached;
    }
    const orderId = 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    this.orders.set(orderId, { placedAt: Date.now(), total });
    const result: OrderResult = {
      orderId,
      status: 'CONFIRMED',
      etaMinutes: 12,
      total,
      raw: { note: '[MOCK] No real order placed.', items: skuIds.length },
    };
    this.placedByKey.set(idempotencyKey, result);
    return result;
  }

  async trackOrder(orderId: string): Promise<TrackResult> {
    const o = this.orders.get(orderId);
    if (!o) return { orderId, status: 'UNKNOWN', raw: { error: 'unknown order_id' } };
    const mins = (Date.now() - o.placedAt) / 60000;
    const status = mins < 2 ? 'PACKING' : mins < 8 ? 'OUT_FOR_DELIVERY' : 'DELIVERED';
    return { orderId, status, etaMinutes: Math.max(0, Math.ceil(12 - mins)) };
  }

  async close(): Promise<void> {
    /* nothing to clean up */
  }
}

function item(
  id: string,
  name: string,
  brand: string,
  price: number,
  packSize: string,
  tags: string[],
): CatalogItem {
  return { id, name: `[DEMO] ${name}`, brand, price, packSize, inStock: true, tags };
}

function toSku(it: CatalogItem): Sku {
  return {
    id: it.id,
    name: it.name,
    brand: it.brand,
    price: it.price,
    packSize: it.packSize,
    inStock: it.inStock,
  };
}
