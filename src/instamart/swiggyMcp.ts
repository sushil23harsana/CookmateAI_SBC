import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { InstamartProvider } from './provider.js';
import type { Sku, OrderResult, TrackResult } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ProviderError } from '../errors.js';
import { SkuSchema } from '../validation/schemas.js';

/**
 * Live Swiggy Instamart provider (POST mcp.swiggy.com/im).
 *
 * The MCP tool names/schemas are only visible once connected, so we DISCOVER
 * tools at connect time and resolve each semantic operation to a tool by regex
 * (overridable via env). Result shapes are run through a tolerant normalizer.
 *
 * AUTH — Phase 0 uses a bearer token (SWIGGY_MCP_TOKEN) for the fastest path to a
 * working demo. Swiggy's documented auth is OAuth 2.1 + PKCE; to finish it,
 * implement an OAuthClientProvider, pass it as `authProvider` to the transport,
 * and complete the redirect + finishAuth() handshake (see SDK docs).
 *
 * GO-LIVE SEAMS (clearly marked below): confirm the search-result field mapping
 * in normalizeSearch(), and wire getItems() to Swiggy's authoritative cart/bill tool.
 */
export class SwiggyInstamartProvider implements InstamartProvider {
  readonly name = 'swiggy';
  private client?: Client;
  private toolNames: string[] = [];

  private async ensure(): Promise<Client> {
    if (this.client) return this.client;
    if (!config.swiggyMcpToken) {
      throw new ProviderError('SWIGGY_MCP_TOKEN is empty — set a bearer token or finish the OAuth flow.');
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

  private resolveTool(envOverride: string | undefined, pattern: RegExp, label: string): string {
    if (envOverride) return envOverride;
    const found = this.toolNames.find((n) => pattern.test(n));
    if (!found) {
      throw new ProviderError(
        `Could not find a Swiggy ${label} tool among [${this.toolNames.join(', ')}]. ` +
          `Set the matching SWIGGY_TOOL_* env var to override.`,
      );
    }
    return found;
  }

  private async callRaw(name: string, args: Record<string, unknown>): Promise<string> {
    const client = await this.ensure();
    try {
      const res = await client.callTool({ name, arguments: args });
      const content = (res.content as Array<{ type: string; text?: string }>) ?? [];
      const text = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
      if (res.isError) throw new ProviderError(`Swiggy tool ${name} returned an error: ${text}`);
      return text || JSON.stringify(res.content ?? {});
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Swiggy tool ${name} call failed: ${msg(err)}`, true);
    }
  }

  async searchItems(query: string, maxResults: number): Promise<Sku[]> {
    await this.ensure();
    const tool = this.resolveTool(process.env.SWIGGY_TOOL_SEARCH, /search|product|item/i, 'search');
    const raw = await this.callRaw(tool, { query, max_results: maxResults });
    return normalizeSearch(raw).slice(0, maxResults);
  }

  async getItems(_ids: string[]): Promise<Sku[]> {
    // GO-LIVE SEAM: Swiggy has no public get-by-id; the authoritative price source
    // is their cart/bill tool. Wire this to add the ids to the Swiggy cart and read
    // the bill breakdown before enabling live ordering.
    throw new ProviderError(
      'getItems is not yet wired to Swiggy. Implement via the Instamart cart/bill tools at go-live.',
    );
  }

  async placeOrder(skuIds: string[], total: number, idempotencyKey: string): Promise<OrderResult> {
    await this.ensure();
    const tool = this.resolveTool(process.env.SWIGGY_TOOL_ORDER, /place.*order|checkout|order/i, 'order');
    const raw = await this.callRaw(tool, { sku_ids: skuIds, total, idempotency_key: idempotencyKey });
    return { orderId: extract(raw, ['order_id', 'orderId']) ?? 'UNKNOWN', status: 'PLACED', total, raw };
  }

  async trackOrder(orderId: string): Promise<TrackResult> {
    await this.ensure();
    const tool = this.resolveTool(process.env.SWIGGY_TOOL_TRACK, /track|status/i, 'track');
    const raw = await this.callRaw(tool, { order_id: orderId });
    return { orderId, status: extract(raw, ['status']) ?? 'UNKNOWN', raw };
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }
}

/** Tolerant normalizer: maps assorted provider field names onto our Sku shape. */
function normalizeSearch(raw: string): Sku[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : ((parsed as Record<string, unknown>)?.results ?? (parsed as Record<string, unknown>)?.items ?? []);
  if (!Array.isArray(arr)) return [];
  const out: Sku[] = [];
  for (const o of arr as Array<Record<string, unknown>>) {
    const candidate = {
      id: o.id ?? o.itemId ?? o.sku ?? o.productId,
      name: o.name ?? o.title ?? o.displayName,
      brand: o.brand ?? o.brandName,
      price: o.price ?? o.finalPrice ?? o.mrp ?? o.sellingPrice,
      packSize: o.packSize ?? o.quantity ?? o.unit,
      inStock: o.inStock ?? o.available ?? true,
    };
    const r = SkuSchema.safeParse(candidate);
    if (r.success) out.push(r.data);
  }
  return out;
}

function extract(raw: string, keys: string[]): string | undefined {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    for (const k of keys) if (typeof o[k] === 'string') return o[k] as string;
  } catch {
    /* not json */
  }
  return undefined;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
