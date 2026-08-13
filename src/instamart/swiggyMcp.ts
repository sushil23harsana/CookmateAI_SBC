import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { InstamartProvider } from './provider.js';
import type {
  Sku,
  OrderResult,
  TrackResult,
  PaymentChoice,
  PaymentOptions,
  PaymentStatus,
  ProviderBill,
} from '../types.js';
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
  payOptions: {
    env: 'SWIGGY_TOOL_PAY_OPTIONS',
    name: 'get_payment_options',
    pattern: /payment.*options/i,
  },
  payStatus: {
    env: 'SWIGGY_TOOL_PAY_STATUS',
    name: 'check_payment_status',
    pattern: /payment.*status/i,
  },
  payConfirm: { env: 'SWIGGY_TOOL_PAY_CONFIRM', name: 'confirm_order', pattern: /confirm.*order/i },
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
  private tokenInUse?: string;

  /**
   * Each web session injects its OWN user's token (minted by that user's OAuth
   * approval), so one visitor can never shop on another's Swiggy account. The
   * default (env token) is for the single-user CLI. addressSource lets the
   * session pin WHICH saved Swiggy address to shop against — availability and
   * prices are address-dependent; without it the first saved address is used.
   */
  constructor(
    private readonly tokenSource: () => string = () => config.swiggyMcpToken,
    private readonly addressSource?: () => string | undefined,
  ) {}

  private async ensure(): Promise<Client> {
    const token = this.tokenSource();
    if (this.client && this.tokenInUse === token) return this.client;
    if (this.client) await this.close(); // token rotated via OAuth — reconnect fresh
    if (!token) {
      throw new ProviderError(
        'This user has not connected a Swiggy account yet — ask them to tap "Connect Swiggy" ' +
          'in the app (their approval mints a 5-day token; v1 has no refresh).',
      );
    }
    try {
      const transport = new StreamableHTTPClientTransport(new URL(config.swiggyMcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: 'cookmate-ai', version: '0.1.0' }, { capabilities: {} });
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.toolNames = tools.map((t) => t.name);
      if (this.toolNames.length === 0) {
        logger.warn('Swiggy tool catalog came back empty — proceeding with documented v1 tool names');
      }
      logger.info('connected to Swiggy Instamart MCP', { tools: this.toolNames });
      this.client = client;
      this.tokenInUse = token;
      return client;
    } catch (err) {
      throw new ProviderError(`Failed to connect to Swiggy MCP: ${msg(err)}`, true);
    }
  }

  private resolve(key: keyof typeof TOOLS): string {
    const spec = TOOLS[key];
    const override = process.env[spec.env];
    if (override) return override;
    // Listing and calling are separate MCP operations — when the catalog comes
    // back empty (seen live 2026-08-12), trust the documented v1 names and let
    // the CALL succeed or fail on its own merits instead of refusing here.
    if (this.toolNames.length === 0) return spec.name;
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
        const texts = content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string);
        const joined = texts.join('\n');
        if (res.isError) throw new ProviderError(`Swiggy tool ${name} returned an error: ${joined}`, true);
        logger.debug('swiggy tool ok', { tool: name, ms: Date.now() - started });
        const structured = (res as { structuredContent?: unknown }).structuredContent;
        return unwrapResult(name, texts, structured, joined);
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

  /** The user's saved Swiggy addresses, PII-light: id + a short label for a picker. */
  async listAddresses(): Promise<Array<{ id: string; label: string }>> {
    const list = await this.fetchAddresses();
    const out = list.map((a) => ({ id: idOf(a) ?? '', label: labelOf(a) })).filter((a) => a.id);
    if (out.length > 0 && out.every((a) => a.label === 'Saved address')) {
      // Ids parsed but no label field matched (seen live 2026-08-13) — sketch
      // one record's keys and types (never values) to learn the real names.
      logger.warn('no label field matched on Swiggy addresses', { record: shapeOf(list[0], 2) });
    }
    return out;
  }

  /**
   * get_addresses with shape-tolerant extraction. When nothing parses, log a
   * PII-safe structural sketch — the docs don't pin the response shape, and
   * this is the only way to see what production actually returned.
   */
  private async fetchAddresses(): Promise<Array<Record<string, unknown>>> {
    const raw = await this.call(this.resolve('addresses'), {}, 2);
    const list = findRecordArray(raw);
    if (list.length === 0) {
      // Pagination counts are not PII and settle the key question: does Swiggy
      // itself say this account has 0 addresses, or did we fail to parse them?
      const pagination = asRecord(asRecord(raw).pagination);
      logger.warn('get_addresses returned no parseable addresses', {
        shape: shapeOf(raw),
        // When the payload is still an unparseable string, its opening chars
        // reveal the wrapper (fence/prose) without exposing address details.
        head: typeof raw === 'string' ? raw.slice(0, 40) : undefined,
        total: pagination.total,
        totalPages: pagination.totalPages,
      });
    }
    return list;
  }

  /**
   * Resolve and cache the delivery address — search and checkout both require it.
   * Honors the session's picked address; a change invalidates the cache so the
   * very next call shops against the new location.
   */
  private async resolveAddress(): Promise<SwiggyAddress> {
    const chosen = this.addressSource?.();
    if (this.address && (!chosen || this.address.id === chosen)) return this.address;
    const list = await this.fetchAddresses();
    const pick = (chosen && list.find((a) => idOf(a) === chosen)) || list[0];
    const id = idOf(pick);
    if (!id) {
      throw new ProviderError(
        'No saved delivery address on this Swiggy account — add one in the Swiggy app ' +
          '(or via the create_address tool) before ordering.',
      );
    }
    this.address = {
      id,
      lat: numish(pick?.lat ?? pick?.latitude),
      lng: numish(pick?.lng ?? pick?.longitude),
    };
    logger.info('using Swiggy delivery address', { addressId: this.address.id });
    return this.address;
  }

  async searchItems(query: string, maxResults: number): Promise<Sku[]> {
    const address = await this.resolveAddress();
    const data = await this.call(this.resolve('search'), { addressId: address.id, query }, 2);
    const skus = normalizeCatalog(data).slice(0, maxResults);
    if (skus.length === 0) {
      // Product data is not PII — sketch the shape so field mismatches show in logs.
      logger.warn('search_products returned no parseable products', {
        query,
        shape: shapeOf(data),
        head: typeof data === 'string' ? data.slice(0, 60) : undefined,
      });
    }
    return skus;
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
    if (skus.length === 0 && ids.length > 0) {
      logger.warn('get_cart returned no parseable items', {
        shape: shapeOf(cart),
        head: typeof cart === 'string' ? cart.slice(0, 60) : undefined,
      });
    }
    // Swiggy's billBreakdown is the ONLY truthful final amount — delivery fee,
    // taxes and discounts never appear on the item prices themselves.
    this.bill = parseBill(asRecord(cart));
    logger.info('swiggy cart priced', {
      requested: new Set(ids).size,
      priced: skus.length,
      toPay: this.bill?.toPay,
    });
    return skus;
  }

  private bill?: ProviderBill;

  lastBill(): ProviderBill | undefined {
    return this.bill;
  }

  async placeOrder(
    skuIds: string[],
    total: number,
    idempotencyKey: string,
    payment?: PaymentChoice,
  ): Promise<OrderResult> {
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

    // Cash is the documented default; UPI adds intentApp (mobile) or a QR (desktop).
    const args: Record<string, unknown> = { addressId: address.id };
    if (payment?.method === 'upi') {
      args.paymentMethod = 'UPI';
      if (payment.intentApp) args.intentApp = payment.intentApp;
      else args.generateUPIQR = true;
    }

    try {
      // Checkout is NOT idempotent — NEVER retried.
      const data = asRecord(await this.call(this.resolve('checkout'), args, 0));
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

  /**
   * Live payment options for the CURRENT server-side cart (context is resolved
   * by Swiggy; no params). get_cart does not include UPI methods — this is the
   * only source. `platforms` is absent entirely when UPI is unavailable.
   */
  async getPaymentOptions(): Promise<PaymentOptions> {
    const data = asRecord(await this.call(this.resolve('payOptions'), {}, 2));
    const platforms = asRecord(data.platforms);
    const mobileMethods = firstArray(asRecord(platforms.mobile), ['methods']) as Array<
      Record<string, unknown>
    >;
    const desktopMethods = firstArray(asRecord(platforms.desktop), ['methods']) as Array<
      Record<string, unknown>
    >;
    return {
      codAvailable: true, // v1 platform default; the cod object just carries its label
      upiApps: mobileMethods
        .map((m) => ({ id: str(m.id) ?? '', label: str(m.label) ?? '' }))
        .filter((m) => m.id && m.label),
      qrAvailable: desktopMethods.length > 0,
    };
  }

  /**
   * One status read for an in-flight UPI payment. Swiggy long-polls ~19s server
   * side, so this is called sparingly and NEVER retried; passing orderId lets
   * their side auto-confirm on success.
   */
  async checkPaymentStatus(paasId: string, orderId?: string): Promise<PaymentStatus> {
    const data = asRecord(
      await this.call(this.resolve('payStatus'), { paasId, ...(orderId ? { orderId } : {}) }, 0),
    );
    return toPaymentStatus(data);
  }

  /** Poll-timeout fallback (documented as idempotent and safe to retry). */
  async confirmPendingOrder(orderId: string, paasId: string): Promise<PaymentStatus> {
    const data = asRecord(await this.call(this.resolve('payConfirm'), { orderId, paasId }, 1));
    return toPaymentStatus(data);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.address = undefined;
  }
}

function toPaymentStatus(data: Record<string, unknown>): PaymentStatus {
  const status = (str(data.status) ?? 'pending').toLowerCase();
  return {
    status,
    terminal:
      data.terminal === true ||
      ['success', 'paid', 'failed', 'refund-initiated', 'cancelled', 'cart_changed'].includes(status),
    confirmed: data.confirmed === true || data.isTerminalSuccess === true,
    orderStatus: str(data.orderStatus),
  };
}

/** { success:false, error } is a domain failure even though the HTTP call succeeded. */
/**
 * Tool results carry text blocks and/or structuredContent, and live text blocks
 * are not always bare JSON (seen 2026-08-13: a 2KB string JSON.parse rejects —
 * likely fence- or prose-wrapped). Try the joined text, then each block, then
 * structuredContent; only fall back to raw text when nothing parses.
 */
function unwrapResult(tool: string, texts: string[], structured: unknown, joined: string): unknown {
  for (const candidate of texts.length > 1 ? [joined, ...texts] : texts) {
    const parsed = tryParseJson(candidate);
    if (parsed) return unwrapParsed(tool, parsed.value);
  }
  if (structured !== undefined) return unwrapParsed(tool, structured);
  return joined;
}

/** Parse JSON that may be fence-wrapped or embedded in prose. */
function tryParseJson(text: string): { value: unknown } | undefined {
  const candidates = [text];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) candidates.push(fence[1]);
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return { value: JSON.parse(c.trim()) };
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function unwrapParsed(tool: string, parsed: unknown): unknown {
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
  const arr = findRecordArray(data, ['products', 'items', 'results', 'data']);
  const out: Sku[] = [];
  for (const o of arr as Array<Record<string, unknown>>) {
    // Live field is `variations` (docs prose says variants — both accepted).
    const variantList = o.variations ?? o.variants;
    const variants = Array.isArray(variantList) ? (variantList as Array<Record<string, unknown>>) : [o];
    for (const v of variants) {
      // Field names differ per tool (live 2026-08-13): search variations use
      // displayName/quantityDescription/price{offerPrice,mrp}; cart items use
      // itemName/itemVariant/discountedFinalPrice/mrp.
      const candidate = {
        id: v.spinId ?? v.spin_id ?? v.id ?? o.spinId ?? o.id ?? o.itemId ?? o.productId,
        name: v.displayName ?? v.name ?? v.itemName ?? o.displayName ?? o.name ?? o.title,
        brand: v.brandName ?? v.brand ?? o.brand ?? o.brandName,
        price: priceOf(
          v.price ??
            v.discountedFinalPrice ??
            v.finalPrice ??
            v.sellingPrice ??
            v.offerPrice ??
            v.mrp ??
            o.price,
        ),
        packSize: v.quantityDescription ?? v.itemVariant ?? v.packSize ?? v.weight ?? v.unit ?? o.packSize,
        inStock: v.isInStockAndAvailable ?? v.inStock ?? v.available ?? o.inStock ?? true,
      };
      const r = SkuSchema.safeParse(candidate);
      if (r.success) out.push(r.data);
    }
  }
  return out;
}

/** Live prices arrive as { mrp, offerPrice, unitLevelPrice } objects — pick the payable number. */
function priceOf(p: unknown): unknown {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const r = p as Record<string, unknown>;
    return r.offerPrice ?? r.finalPrice ?? r.sellingPrice ?? r.price ?? r.mrp;
  }
  return p;
}

/** Collapse a (possibly duplicated) sku-id list into update_cart's { spinId, quantity }. */
function toCartItems(ids: string[]): Array<{ spinId: string; quantity: number }> {
  const qty = new Map<string, number>();
  for (const id of ids) qty.set(id, (qty.get(id) ?? 0) + 1);
  return [...qty.entries()].map(([spinId, quantity]) => ({ spinId, quantity }));
}

function toOrder(data: Record<string, unknown>, total: number, idempotencyKey: string): OrderResult {
  const status = str(data.status) ?? 'PLACED';
  const pendingPayment = status.toUpperCase() === 'PENDING_PAYMENT';
  return {
    orderId: str(data.orderId ?? data.order_id ?? data.id) ?? `UNVERIFIED-${idempotencyKey.slice(-8)}`,
    status,
    etaMinutes: num(data.etaMinutes ?? data.eta),
    total,
    raw: data,
    ...(pendingPayment
      ? {
          pendingPayment,
          paasId: str(data.paasId),
          upiIntentUrl: str(data.upiIntentUrl),
          pollingIntervalInMs: num(data.pollingIntervalInMs) ?? 5000,
          maxTimeToPollForInMs: num(data.maxTimeToPollForInMs) ?? 300000,
        }
      : {}),
  };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function firstArray(o: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}

/** Short human label for an address picker, checking one level of nesting too. */
function labelOf(a: Record<string, unknown>): string {
  // Live field names (2026-08-13): addressTag ("Home"), addressCategory, addressLine.
  const tag = pickStr(a, ['addressTag', 'addressCategory', 'annotation', 'label', 'tag', 'name']);
  const place = pickStr(a, [
    'addressLine',
    'area',
    'locality',
    'city',
    'address',
    'addressLine1',
    'street',
    'landmark',
  ])?.slice(0, 44);
  return [tag, place].filter(Boolean).join(' · ').slice(0, 60) || 'Saved address';
}

function pickStr(a: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  // e.g. { address: { area, city } } — the label often lives one level down
  for (const v of Object.values(a)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of keys) {
        const nv = (v as Record<string, unknown>)[k];
        if (typeof nv === 'string' && nv.trim().length > 0) return nv.trim();
      }
    }
  }
  return undefined;
}

/**
 * Extract the authoritative bill from a live get_cart response:
 * { cartTotalAmount, billBreakdown: { lineItems: [...], toPay: { label, value } } }.
 * Values arrive as strings ("₹351") or numbers; parse tolerantly and return
 * undefined when nothing usable is present so the engine keeps its own math.
 */
function parseBill(cart: Record<string, unknown>): ProviderBill | undefined {
  const bb = asRecord(cart.billBreakdown);
  const lines = (Array.isArray(bb.lineItems) ? bb.lineItems : [])
    .map((l) => {
      const r = asRecord(l);
      return {
        label: str(r.label ?? r.name ?? r.title) ?? '',
        amount: money(r.value ?? r.amount ?? r.price),
      };
    })
    .filter((l): l is { label: string; amount: number } => Boolean(l.label) && l.amount !== undefined);
  const toPay = money(asRecord(bb.toPay).value) ?? money(cart.cartTotalAmount);
  if (toPay === undefined && lines.length === 0) return undefined;
  return { toPay, lines };
}

/** "₹1,234.50" | "351" | 351 → number of rupees (undefined when unparseable). */
function money(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Address ids arrive as strings or numbers depending on the endpoint — accept both. */
function idOf(a: Record<string, unknown> | undefined): string | undefined {
  const v = a?.id ?? a?.addressId ?? a?.address_id;
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * The docs don't pin where the list lives (bare array, {addresses}, {data:{addresses}}…),
 * so walk the response and take the first array of records — preferring named keys at
 * any depth so a stray secondary array can't win.
 */
function findRecordArray(
  data: unknown,
  keys: string[] = ['addresses', 'items', 'results', 'data'],
  depth = 4,
): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    const recs = data.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    return recs as Array<Record<string, unknown>>;
  }
  if (!data || typeof data !== 'object' || depth === 0) return [];
  const o = data as Record<string, unknown>;
  for (const k of keys) {
    const hit = findRecordArray(o[k], keys, depth - 1);
    if (hit.length > 0) return hit;
  }
  for (const v of Object.values(o)) {
    const hit = findRecordArray(v, keys, depth - 1);
    if (hit.length > 0) return hit;
  }
  return [];
}

/** PII-safe structural sketch (key names and types only, never values) for log diagnosis. */
function shapeOf(v: unknown, depth = 3): unknown {
  if (Array.isArray(v)) return v.length === 0 ? 'array(0)' : [shapeOf(v[0], depth - 1), `x${v.length}`];
  if (v && typeof v === 'object') {
    if (depth === 0) return 'object';
    const entries = Object.entries(v as Record<string, unknown>).slice(0, 20);
    return Object.fromEntries(entries.map(([k, x]) => [k, shapeOf(x, depth - 1)]));
  }
  return typeof v === 'string' ? `string(${(v as string).length})` : typeof v;
}

const numish = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
