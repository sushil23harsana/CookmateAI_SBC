import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { secureHeaders } from 'hono/secure-headers';
import { config, assertRuntimeConfig } from '../config.js';
import { logger } from '../logger.js';
import { rateLimit } from './rateLimit.js';
import { createSession, getSession, sessionCount, sweepExpiredSessions } from './sessions.js';
import { beginAuthorization, completeAuthorization } from './swiggyOauth.js';
import type { Cart } from '../types.js';

assertRuntimeConfig();

// Origin headers never carry a trailing slash — strip it so a pasted URL still matches.
const allowedOrigins = config.corsOrigin.split(',').map((s) => s.trim().replace(/\/+$/, ''));

const app = new Hono();

// Security headers + CORS locked to the configured frontend origin(s).
app.use('/api/*', secureHeaders());
app.use('/api/*', cors({ origin: allowedOrigins, maxAge: 600 }));

// Health is intentionally registered BEFORE the rate limiter so monitors aren't throttled.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    commit: (process.env.RENDER_GIT_COMMIT ?? 'dev').slice(0, 7),
    provider: config.provider,
    llm: config.llm,
    model: config.llm === 'openai' ? config.openaiModel : config.model,
    fallback: config.llm === 'openai' ? Boolean(config.anthropicApiKey) : Boolean(config.openaiApiKey),
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

/** Whether THIS session's user has connected a Swiggy account (never the token itself). */
app.get('/api/swiggy/status', (c) => {
  const sessionId = c.req.query('sessionId');
  const session = sessionId ? getSession(sessionId) : undefined;
  return c.json({
    provider: config.provider,
    connected: Boolean(session?.swiggyToken),
    expiresAt: session?.swiggyTokenExpiresAt
      ? new Date(session.swiggyTokenExpiresAt).toISOString()
      : undefined,
  });
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
    let cartSeenThisTurn = false;
    const onStatus = (p: unknown) => stream.writeSSE({ event: 'status', data: JSON.stringify(p) });
    const onCart = (cart: Cart) => {
      cartSeenThisTurn = true;
      return stream.writeSSE({ event: 'cart', data: JSON.stringify(cart) });
    };
    const onDelta = (delta: string) => stream.writeSSE({ event: 'delta', data: JSON.stringify({ delta }) });
    session.bus.on('status', onStatus);
    session.bus.on('cart', onCart);
    session.bus.on('delta', onDelta);

    await stream.writeSSE({ event: 'status', data: JSON.stringify({ phase: 'recipe' }) });
    try {
      // If the user tweaked quantities with the +/- buttons, the model never saw
      // that re-review — tell it once so it doesn't revert the edits.
      let outgoing = message;
      if (session.manualSkuIds) {
        outgoing =
          `[SYSTEM NOTE, not typed by the user: since your last reply they adjusted the cart ` +
          `with its +/- buttons. The current reviewed cart is cart_id ${session.lastCartId ?? 'unknown'} ` +
          `with sku_ids ${JSON.stringify(session.manualSkuIds)}. Base any further changes on this list.]\n\n` +
          message;
        session.manualSkuIds = undefined;
      }
      let text = await session.agent.send(outgoing);
      // Deterministic guard: the model may claim cart changes and point at the
      // "Place order" button without having called review_cart — in which case
      // no cart card exists in the UI and nothing was actually changed. Force
      // exactly one corrective re-review; the prompt rule alone is probabilistic.
      if (!cartSeenThisTurn && /place order/i.test(text)) {
        logger.warn('reply referenced Place order without a reviewed cart — nudging re-review');
        // Tell the UI a cart rebuild is starting so it closes the streamed bubble
        // cleanly — otherwise the nudged reply's text can merge into the first one.
        await stream.writeSSE({
          event: 'status',
          data: JSON.stringify({ phase: 'cart', tool: 'review_cart' }),
        });
        text = await session.agent.send(
          'SYSTEM CHECK (not the user): Your reply told the user to tap "Place order" ' +
            'but you did not call review_cart this turn, so NO cart card exists and none ' +
            'of the changes you described were applied. Call review_cart now with the ' +
            'complete current sku list matching what you described, then reply in one short line.',
        );
      }
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

/**
 * UI quantity steppers: build a fresh AUTHORITATIVE cart snapshot from the
 * given sku list (repeat an id for qty > 1). Prices and totals stay
 * server-computed, so the immutable-cart safety model is untouched.
 */
app.post('/api/cart', async (c) => {
  const body = await readJson<{ sessionId?: string; skuIds?: unknown }>(c);
  if (!body?.sessionId) return c.json({ error: 'sessionId is required' }, 400);
  const { skuIds } = body;
  if (
    !Array.isArray(skuIds) ||
    skuIds.length === 0 ||
    skuIds.length > 100 ||
    !skuIds.every((s): s is string => typeof s === 'string' && s.length > 0)
  ) {
    return c.json({ error: 'skuIds must be a non-empty array of sku id strings' }, 400);
  }
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  if (session.busy) {
    return c.json({ error: 'Still working on your last message — try once the reply lands.' }, 409);
  }
  try {
    const res = await session.execute('review_cart', { sku_ids: skuIds });
    const parsed = JSON.parse(res.result) as { cart?: Cart };
    if (parsed.cart) session.manualSkuIds = skuIds;
    return c.json(parsed);
  } catch (err) {
    logger.warn('manual cart review failed', err);
    return c.json({ error: 'Could not update the cart — try asking in the chat instead.' }, 400);
  }
});

/**
 * Kick off the Swiggy OAuth 2.1 + PKCE flow for ONE web session — the state
 * carries the session id, so the token minted at the callback belongs to the
 * visitor who approved it, never to anyone else (and never to the operator).
 */
app.get('/oauth/start', async (c) => {
  const sessionId = c.req.query('session');
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) {
    return c.html(
      oauthPage('Session expired', 'Go back to CookMate, refresh the page, and tap Connect Swiggy again.'),
      400,
    );
  }
  try {
    return c.redirect(await beginAuthorization(session.id));
  } catch (err) {
    logger.error('could not begin Swiggy authorization', err);
    return c.html(
      oauthPage('Could not reach Swiggy', 'Starting the authorization failed — try again in a minute.'),
      502,
    );
  }
});

/**
 * OAuth 2.1 + PKCE redirect target (whitelisted with Swiggy — must match exactly).
 * Exchanges the single-use, 120-second code for a 5-day bearer token and hands it
 * to the Swiggy provider. Codes and tokens are never echoed back or logged.
 */
app.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const denied = c.req.query('error');
  if (denied || !code || !state) {
    return c.html(
      oauthPage(
        'Authorization was not completed',
        'No worries — close this tab and try connecting again from CookMate.',
      ),
      400,
    );
  }
  try {
    const { sessionId, accessToken, expiresInSec } = await completeAuthorization(code, state);
    const session = getSession(sessionId);
    if (!session) {
      return c.html(
        oauthPage(
          'Session expired',
          'Your CookMate session ended while you were approving — refresh the app and connect again.',
        ),
        400,
      );
    }
    session.swiggyToken = accessToken;
    session.swiggyTokenExpiresAt = expiresInSec ? Date.now() + expiresInSec * 1000 : undefined;
    logger.info('swiggy account connected to session', { sessionId });
    return c.html(
      oauthPage(
        'Swiggy connected ✅',
        'CookMate can now shop on your Instamart account — you can close this tab.',
      ),
    );
  } catch (err) {
    logger.warn('swiggy token exchange failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.html(
      oauthPage(
        'Connection could not be completed',
        'The sign-in expired or was already used — start again from CookMate.',
      ),
      400,
    );
  }
});

function oauthPage(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookMate AI</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif;background:#fff8ef;color:#3b2f24">
<div style="text-align:center;padding:32px;max-width:420px">
<div style="font-size:40px">🍳</div><h1 style="font-size:20px;margin:12px 0 8px">${title}</h1>
<p style="margin:0;color:#8a7a66">${body}</p></div></body>`;
}

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
