import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { InstamartProvider } from './provider.js';
import type { Sku, OrderResult, TrackResult } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ProviderError } from '../errors.js';
import { SkuSchema } from '../validation/schemas.js';

/**
 * Live Swiggy Instamart provider (streamable HTTP, POST mcp.swiggy.com/im),
 * written to the documented Builders Club contract:
 *
 *   get_addresses -> search_products -> update_cart -> get_cart -> checkout -> track_order
 *   (https://mcp.swiggy.com/builders/docs/reference/instamart/)
 *
 * Platform rules encoded here:
 *  - search_products and checkout REQUIRE an addressId (resolved once from get_addresses).
 *  - Cart items are variants identified by `spinId`; update_cart REPLACES the whole cart.
 *  - checkout is NOT idempotent: never blind-retry — on failure, verify via get_orders.
 *  - checkout is COD-only in v1 and carts of ₹1000+ are app-only.
 *  - Domain failures arrive as HTTP 200 + { success:false, error:{ message } }.
 *  - Reads and cart mutations may retry with backoff (500ms doubling, jitter); checkout never.
 *
 * AUTH — Phase 0 uses a bearer token (SWIGGY_MCP_TOKEN). Tokens live 5 days and v1 has
 * no refresh: on 401, re-run the OAuth 2.1 + PKCE flow and set a fresh token.
 *
 * FIRST-CONNECT VERIFICATION (go-live seam): response FIELD names below follow the docs'
 * envelope but must be confirmed against one real session before enabling live orders.
 */

const CHECKOUT_MAX_RUPEES = 1000; // platform rule (v1): bigger carts are app-only

/** v1 tool names from the docs — exact match first, env override, regex as last resort. */
const TOOLS = {
  addresses: { env: 'SWIGGY_TOOL_ADDRESSES', name: 'get_addresses', pattern: /get.*address/i },
  search: { env: 'SWIGGY_TOOL_SEARCH', name: 'search_products', pattern: /search.*product/i },
  updateCart: { env: 'SWIGGY_TOOL_UPDATE_CART', name: 'update_cart', pattern: /update.*cart/i },
  getCart: { env: 'SWIGGY_TOOL_GET_CART', name: 'get_cart', pattern: /^get.*cart/i },
  checkout: { env: 'SWIGGY_TOOL_ORDER', name: 'checkout', pattern: /checkout/i },
  orders: { env: 'SWIGGY_TOOL_ORDERS', name: 'get_orders', pattern: /get.*orders$/i },
  track: { env: 'SWIGGY_TOOL_TRACK', name: 'track_order', pattern: /track/i },
} as const;

interface SwiggyAddress {
  id: string;
  lat?: number;
  lng?: number;
}

export class SwiggyInstamartProvider implements InstamartProvider {
  readonly name = 'swiggy';
  private client?: Client;
  private toolNames: string[] = [];
  private address?: SwiggyAddress;

  private async ensure(): Promise<Client> {
    if (this.client) return this.client;
    if (!config.swiggyMcpToken) {
      throw new ProviderError(
        'SWIGGY_MCP_TOKEN is empty — complete the OAuth 2.1 + PKCE flow and set the bearer token ' +
          '(tokens last 5 days; v1 has no refresh).',
      );
    }
    try {
      const transport = new StreamableHTTPClientTransport(new URL(config.swiggyMcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${config.swiggyMcpToken}` } },
      });
      const client = new Client({ name: 'cookmate-ai', version: '0.1.0' }, { capabilities: {} });
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.toolNames = tools.map((t) => t.name);
      logger.info('connected to Swiggy Instamart MCP', { tools: this.toolNames });
      this.client = client;
      return client;
    } catch (err) {
      throw new ProviderError(`Failed to connect to Swiggy MCP: ${msg(err)}`, true);
    }
  }

  private resolve(key: keyof typeof TOOLS): string {
    const spec = TOOLS[key];
    const override = process.env[spec.env];
    if (override) return override;
    if (this.toolNames.includes(spec.name)) return spec.name;
    const found = this.toolNames.find((n) => spec.pattern.test(n));
    if (!found) {
      throw new ProviderError(
        `Could not find the Swiggy "${spec.name}" tool among [${this.toolNames.join(', ')}]. ` +
          `Set ${spec.env} to override.`,
      );
    }
    return found;
  }

  /**
   * Call a tool and unwrap the documented envelope. Domain failures come back as a
   * SUCCESSFUL response containing { success:false, error } — treating that text as data
   * is how an agent reports a failed checkout as a placed order, so it throws here.
   */
  private async call(name: string, args: Record<string, unknown>, retries = 0): Promise<unknown> {
    const client = await this.ensure();
    let delayMs = 500; // documented backoff: 500ms doubling to 8s, with jitter
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const res = await client.callTool({ name, arguments: args });
        const content = (res.content as Array<{ type: string; text?: string }>) ?? [];
        const text = content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
          .join('\n');
        if (res.isError) throw new ProviderError(`Swiggy tool ${name} returned an error: ${text}`, true);
        logger.debug('swiggy tool ok', { tool: name, ms: Date.now() - started });
        return unwrapEnvelope(name, text);
      } catch (err) {
        const retryable = err instanceof ProviderError ? err.retryable : true;
        logger.warn('swiggy tool failed', {
          tool: name,
          ms: Date.now() - started,
          attempt,
          message: msg(err),
        });
        if (!retryable || attempt >= retries) {
          throw err instanceof ProviderError
            ? err
            : new ProviderError(`Swiggy tool ${name} call failed: ${msg(err)}`, true);
        }
        await sleep(delayMs + Math.random() * delayMs * 0.3);
        delayMs = Math.min(delayMs * 2, 8000);
      }
    }
  }

  /** Resolve and cache the delivery address — search and checkout both require it. */
  private async resolveAddress(): Promise<SwiggyAddress> {
    if (this.address) return this.address;
    const data = asRecord(await this.call(this.resolve('addresses'), {}, 2));
    const list = firstArray(data, ['addresses', 'items', 'results']);
    const first = list[0] as Record<string, unknown> | undefined;
    const id = str(first?.id ?? first?.addressId ?? first?.address_id);
    if (!id) {
      throw new ProviderError(
        'No saved delivery address on this Swiggy account — add one in the Swiggy app ' +
          '(or via the create_address tool) before ordering.',
      );
    }
    this.address = {
      id,
      lat: num(first?.lat ?? first?.latitude),
      lng: num(first?.lng ?? first?.longitude),
    };
    logger.info('using Swiggy delivery address', { addressId: this.address.id });
    return this.address;
  }

  async searchItems(query: string, maxResults: number): Promise<Sku[]> {
    const address = await this.resolveAddress();
    const data = await this.call(this.resolve('search'), { addressId: address.id, query }, 2);
    return normalizeCatalog(data).slice(0, maxResults);
  }

  /**
   * Authoritative prices via the documented cart flow: update_cart REPLACES the server
   * cart with exactly these items, then get_cart returns the priced line items + bill.
   */
  async getItems(ids: string[]): Promise<Sku[]> {
    const address = await this.resolveAddress();
    await this.call(
      this.resolve('updateCart'),
      { selectedAddressId: address.id, items: toCartItems(ids) },
      2,
    );
    const cart = await this.call(this.resolve('getCart'), {}, 2);
    const skus = normalizeCatalog(cart);
    logger.info('swiggy cart priced', { requested: new Set(ids).size, priced: skus.length });
    return skus;
  }

  async placeOrder(skuIds: string[], total: number, idempotencyKey: string): Promise<OrderResult> {
    if (total >= CHECKOUT_MAX_RUPEES) {
      throw new ProviderError(
        `Swiggy caps agent checkout at ₹${CHECKOUT_MAX_RUPEES} (v1) — this ₹${total} cart must be ` +
          `placed in the Swiggy app, or trimmed below the cap.`,
      );
    }
    const address = await this.resolveAddress();
    // Re-assert the exact reviewed items so the server cart can't have drifted between
    // review and confirmation (update_cart is documented as safe to retry).
    await this.call(
      this.resolve('updateCart'),
      { selectedAddressId: address.id, items: toCartItems(skuIds) },
      2,
    );

    try {
      // COD-only in v1; omitting paymentMethod uses the documented default. NEVER retried.
      const data = asRecord(await this.call(this.resolve('checkout'), { addressId: address.id }, 0));
      return toOrder(data, total, idempotencyKey);
    } catch (err) {
      // Documented check-then-retry: checkout is not idempotent, so on failure verify
      // whether the order actually went through before surfacing an error.
      logger.warn('checkout failed — verifying via get_orders', { message: msg(err) });
      await sleep(2500);
      const placed = await this.findJustPlacedOrder();
      if (placed) return { ...placed, total };
      throw err;
    }
  }

  /** After a failed checkout, look for an order created moments ago (docs' verify step). */
  private async findJustPlacedOrder(): Promise<OrderResult | undefined> {
    try {
      const data = asRecord(await this.call(this.resolve('orders'), {}, 1));
      const latest = firstArray(data, ['orders', 'items', 'results'])[0] as
        Record<string, unknown> | undefined;
      const orderId = str(latest?.orderId ?? latest?.order_id ?? latest?.id);
      const createdAt = num(latest?.createdAt ?? latest?.created_at ?? latest?.orderTime);
      const isFresh = createdAt !== undefined && Math.abs(Date.now() - createdAt) < 3 * 60_000;
      if (orderId && isFresh) {
        logger.info('checkout had succeeded — recovered via get_orders', { orderId });
        return { orderId, status: str(latest?.status) ?? 'PLACED', total: 0, raw: latest };
      }
    } catch {
      /* verification is best-effort; the original error is surfaced */
    }
    return undefined;
  }

  async trackOrder(orderId: string): Promise<TrackResult> {
    const address = await this.resolveAddress();
    const data = asRecord(
      await this.call(this.resolve('track'), { orderId, lat: address.lat, lng: address.lng }, 2),
    );
    return {
      orderId,
      status: str(data.status ?? data.orderStatus) ?? 'UNKNOWN',
      etaMinutes: num(data.etaMinutes ?? data.eta ?? data.deliveryEtaMinutes),
      raw: data,
    };
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.address = undefined;
  }
}

/** { success:false, error } is a domain failure even though the HTTP call succeeded. */
function unwrapEnvelope(tool: string, text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text; // not JSON — let the caller's normalizer decide
  }
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    const env = parsed as { success: boolean; data?: unknown; error?: { message?: string } };
    if (!env.success) {
      throw new ProviderError(`Swiggy ${tool} failed: ${env.error?.message ?? 'unknown error'}`);
    }
    return env.data ?? parsed;
  }
  return parsed;
}

/**
 * Tolerant catalog/cart normalizer. Instamart products contain VARIANTS (pack sizes),
 * and it's the variant `spinId` — not the parent product id — that goes in the cart,
 * so variants are flattened into individual SKUs.
 */
function normalizeCatalog(data: unknown): Sku[] {
  const root = asRecord(data);
  const arr = Array.isArray(data) ? data : firstArray(root, ['products', 'items', 'results']);
  const out: Sku[] = [];
  for (const o of arr as Array<Record<string, unknown>>) {
    const variants = Array.isArray(o.variants) ? (o.variants as Array<Record<string, unknown>>) : [o];
    for (const v of variants) {
      const candidate = {
        id: v.spinId ?? v.spin_id ?? v.id ?? o.spinId ?? o.id ?? o.itemId ?? o.productId,
        name: v.name ?? v.displayName ?? o.name ?? o.title ?? o.displayName,
        brand: v.brand ?? o.brand ?? o.brandName,
        price: v.price ?? v.finalPrice ?? v.sellingPrice ?? v.offerPrice ?? v.mrp ?? o.price,
        packSize: v.packSize ?? v.quantity ?? v.weight ?? v.unit ?? o.packSize,
        inStock: v.inStock ?? v.available ?? o.inStock ?? true,
      };
      const r = SkuSchema.safeParse(candidate);
      if (r.success) out.push(r.data);
    }
  }
  return out;
}

/** Collapse a (possibly duplicated) sku-id list into update_cart's { spinId, quantity }. */
function toCartItems(ids: string[]): Array<{ spinId: string; quantity: number }> {
  const qty = new Map<string, number>();
  for (const id of ids) qty.set(id, (qty.get(id) ?? 0) + 1);
  return [...qty.entries()].map(([spinId, quantity]) => ({ spinId, quantity }));
}

function toOrder(data: Record<string, unknown>, total: number, idempotencyKey: string): OrderResult {
  return {
    orderId: str(data.orderId ?? data.order_id ?? data.id) ?? `UNVERIFIED-${idempotencyKey.slice(-8)}`,
    status: str(data.status) ?? 'PLACED',
    etaMinutes: num(data.etaMinutes ?? data.eta),
    total,
    raw: data,
  };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function firstArray(o: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
