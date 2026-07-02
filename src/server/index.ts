import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { secureHeaders } from 'hono/secure-headers';
import { config, assertRuntimeConfig } from '../config.js';
import { logger } from '../logger.js';
import { rateLimit } from './rateLimit.js';
import { createSession, getSession, sessionCount, sweepExpiredSessions } from './sessions.js';
import type { Cart } from '../types.js';

assertRuntimeConfig();

const allowedOrigins = config.corsOrigin.split(',').map((s) => s.trim());

const app = new Hono();

// Security headers + CORS locked to the configured frontend origin(s).
app.use('/api/*', secureHeaders());
app.use('/api/*', cors({ origin: allowedOrigins, maxAge: 600 }));

// Health is intentionally registered BEFORE the rate limiter so monitors aren't throttled.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    provider: config.provider,
    model: config.model,
    sessions: sessionCount(),
    uptimeSec: Math.round(process.uptime()),
  }),
);

// Per-IP rate limit on everything below (the endpoints that cost money/CPU).
app.use('/api/*', rateLimit({ limit: config.rateLimitPerMin, trustProxy: config.trustProxy }));

app.post('/api/session', (c) => {
  const s = createSession();
  return c.json({ sessionId: s.id });
});

/** Streaming chat: live phase + cart events, then the final assistant message. */
app.post('/api/chat', async (c) => {
  const body = await readJson<{ sessionId?: string; message?: string }>(c);
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  const { sessionId, message } = body;

  if (typeof message !== 'string' || message.trim().length === 0) {
    return c.json({ error: 'message is required' }, 400);
  }
  if (message.length > config.messageMaxChars) {
    return c.json({ error: `message too long (max ${config.messageMaxChars} characters)` }, 413);
  }
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  if (session.busy) {
    return c.json({ error: 'Still working on your last message — one at a time, please.' }, 409);
  }
  session.busy = true;

  return streamSSE(c, async (stream) => {
    const onStatus = (p: unknown) => stream.writeSSE({ event: 'status', data: JSON.stringify(p) });
    const onCart = (cart: Cart) => stream.writeSSE({ event: 'cart', data: JSON.stringify(cart) });
    const onDelta = (delta: string) => stream.writeSSE({ event: 'delta', data: JSON.stringify({ delta }) });
    session.bus.on('status', onStatus);
    session.bus.on('cart', onCart);
    session.bus.on('delta', onDelta);

    await stream.writeSSE({ event: 'status', data: JSON.stringify({ phase: 'recipe' }) });
    try {
      const text = await session.agent.send(message);
      await stream.writeSSE({ event: 'message', data: JSON.stringify({ text }) });
    } catch (err) {
      logger.error('chat turn failed', err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'Something went wrong on my end — mind trying that again?' }),
      });
    } finally {
      session.busy = false;
      session.bus.off('status', onStatus);
      session.bus.off('cart', onCart);
      session.bus.off('delta', onDelta);
      await stream.writeSSE({ event: 'done', data: '{}' });
    }
  });
});

/** The confirm gate as a UI action: tapping "Place order" arms the one-shot gate. */
app.post('/api/order', async (c) => {
  const body = await readJson<{ sessionId?: string; cartId?: string }>(c);
  if (!body?.sessionId || !body.cartId) return c.json({ error: 'sessionId and cartId are required' }, 400);
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);

  // Arm the one-shot gate for exactly this cart; the executor's confirm hook
  // consumes it and verifies the cartId matches before any money moves.
  session.armedCartId = body.cartId;
  try {
    const res = await session.execute('place_order', { cart_id: body.cartId });
    return c.json(JSON.parse(res.result));
  } finally {
    session.armedCartId = undefined;
  }
});

app.post('/api/track', async (c) => {
  const body = await readJson<{ sessionId?: string; orderId?: string }>(c);
  if (!body?.sessionId || !body.orderId) return c.json({ error: 'sessionId and orderId are required' }, 400);
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  const res = await session.execute('track_order', { order_id: body.orderId });
  return c.json(JSON.parse(res.result));
});

async function readJson<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info(`Cookmate server on http://localhost:${config.port}`, {
    provider: config.provider,
    cors: allowedOrigins,
    rateLimitPerMin: config.rateLimitPerMin,
  });
});

// Reap idle sessions so memory stays bounded.
const sweep = setInterval(() => {
  const n = sweepExpiredSessions();
  if (n > 0) logger.info('reaped idle sessions', { count: n });
}, 60_000);
sweep.unref?.();

function shutdown(signal: string): void {
  logger.info('shutting down', { signal });
  clearInterval(sweep);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
