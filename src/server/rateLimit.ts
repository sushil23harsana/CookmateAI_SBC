import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { logger } from '../logger.js';

/**
 * Simple per-IP fixed-window rate limiter. In-memory (single instance) — good
 * enough to stop a casual abuser from running up the Anthropic bill at this
 * scale. For multi-instance, back this with Redis (see PRODUCTION_READINESS.md).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: {
  limit: number;
  windowMs?: number;
  /** Honor X-Forwarded-For only when we're actually behind a trusted proxy. */
  trustProxy?: boolean;
}): MiddlewareHandler {
  const windowMs = opts.windowMs ?? 60_000;
  const buckets = new Map<string, Bucket>();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, windowMs);
  timer.unref?.();

  return async (c, next) => {
    const ip = clientIp(c, opts.trustProxy === true);
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;

    c.header('X-RateLimit-Limit', String(opts.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, opts.limit - b.count)));

    if (b.count > opts.limit) {
      c.header('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      logger.warn('rate limit exceeded', { ip, count: b.count });
      return c.json({ error: 'Too many requests — please slow down a moment.' }, 429);
    }
    await next();
  };
}

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // The RIGHTMOST entry is the one our own proxy appended; anything left of it
    // is client-supplied and forgeable. Never key rate limits on forgeable input.
    const xff = c.req.header('x-forwarded-for');
    const last = xff?.split(',').pop()?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
