import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { secureHeaders } from 'hono/secure-headers';
import { config, assertRuntimeConfig } from '../config.js';
import { logger } from '../logger.js';
import { rateLimit } from './rateLimit.js';
import {
  createSession,
  disconnectSessions,
  getSession,
  sessionCount,
  sweepExpiredSessions,
} from './sessions.js';
import { beginAuthorization, completeAuthorization } from './swiggyOauth.js';
import { deleteToken, loadToken, saveToken, saveAddress } from './tokenRepo.js';
import { resumeIdentity, verifyConnection } from './access.js';
import { SwiggyInstamartProvider } from '../instamart/swiggyMcp.js';
import type { Cart } from '../types.js';

assertRuntimeConfig();

// Origin headers never carry a trailing slash — strip it so a pasted URL still matches.
const allowedOrigins = config.corsOrigin.split(',').map((s) => s.trim().replace(/\/+$/, ''));

export const app = new Hono();

// Security headers + CORS locked to the configured frontend origin(s).
app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  c.header('Referrer-Policy', 'no-referrer');
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use('/api/*', cors({ origin: allowedOrigins, maxAge: 600 }));
app.use('/oauth/*', async (c, next) => {
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-store');
  await next();
});

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

app.post('/api/session', async (c) => {
  const body = await readJson<{ resumeToken?: unknown }>(c);
  const identity = resumeIdentity(body?.resumeToken);
  const userId = identity.key;
  const s = createSession(userId);
  // Returning user: restore their persisted Swiggy connection onto the new session.
  if (userId) {
    const saved = await loadToken(userId);
    if (saved) {
      s.swiggyToken = saved.token;
      s.swiggyTokenExpiresAt = saved.expiresAt;
      s.swiggyAddressId = saved.addressId;
    }
  }
  return c.json({ sessionId: s.id, resumeToken: identity.token });
});

/** Whether THIS session's user has connected a Swiggy account (never the token itself). */
app.get('/api/swiggy/status', async (c) => {
  const sessionId = c.req.query('sessionId');
  const session = sessionId ? getSession(sessionId) : undefined;
  let connected: boolean;
  try {
    connected = session ? await verifyConnection(session) : false;
  } catch {
    return c.json({ error: 'Could not verify your Swiggy connection. Try again.' }, 503);
  }
  return c.json({
    provider: config.provider,
    // known=false tells the client its saved session died (restart/TTL) — it
    // then mints a fresh one, which restores any persisted connection.
    known: Boolean(session),
    connected: config.provider === 'swiggy' && connected,
    chatAllowed: connected,
    expiresAt: session?.swiggyTokenExpiresAt
      ? new Date(session.swiggyTokenExpiresAt).toISOString()
      : undefined,
  });
});

app.post('/api/swiggy/disconnect', async (c) => {
  const body = await readJson<{ sessionId?: string }>(c);
  const session = body?.sessionId ? getSession(body.sessionId) : undefined;
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  if (session.busy)
    return c.json({ error: 'Wait for the current action to finish before disconnecting.' }, 409);
  try {
    if (session.userId) await deleteToken(session.userId);
  } catch {
    return c.json({ error: 'Could not remove the saved connection. Please retry.' }, 503);
  }
  disconnectSessions(session.userId, session.id);
  return c.json({ ok: true });
});

// The UI lock is only a convenience. All shopping endpoints enforce access here.
app.use('/api/*', async (c, next) => {
  const body =
    c.req.method === 'POST'
      ? ((await c.req.raw
          .clone()
          .json()
          .catch(() => null)) as { sessionId?: string } | null)
      : null;
  const id = body?.sessionId ?? c.req.query('sessionId');
  const session = id ? getSession(id) : undefined;
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  // Lock mutations BEFORE the first network await. Chat owns its streaming lock.
  const mutation = ['/api/cart', '/api/order', '/api/swiggy/address', '/api/shop/reset'].includes(c.req.path);
  if (session.busy && (mutation || c.req.path === '/api/chat')) {
    return c.json({ error: 'Finishing your last action. Please wait a moment.' }, 409);
  }
  if (mutation || c.req.path === '/api/chat') session.busy = true;
  try {
    if (!(await verifyConnection(session))) {
      if (c.req.path === '/api/chat') session.busy = false;
      return c.json(
        { error: 'Connect Swiggy before chatting or shopping.', code: 'CONNECTION_REQUIRED' },
        401,
      );
    }
    await next();
    if (c.req.path === '/api/chat' && c.res.status !== 200) session.busy = false;
  } catch {
    if (c.req.path === '/api/chat') session.busy = false;
    return c.json(
      {
        error: 'Could not verify Swiggy access. Reconnect or try again shortly.',
        code: 'CONNECTION_CHECK_FAILED',
      },
      503,
    );
  } finally {
    if (mutation) session.busy = false;
  }
});

app.post('/api/shop/reset', async (c) => {
  const body = await readJson<{ sessionId?: string }>(c);
  const session = body?.sessionId ? getSession(body.sessionId) : undefined;
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  session.carts.clear();
  session.lastCartId = undefined;
  session.manualSkuIds = undefined;
  session.agent.seed([]);
  return c.json({ ok: true });
});

/**
 * The connected user's saved Swiggy addresses (id + short label only) — shown
 * as a picker because availability and prices depend on the delivery address.
 * Defaults the session's pick to the first address so shopping works instantly.
 */
app.get('/api/swiggy/addresses', async (c) => {
  const sessionId = c.req.query('sessionId');
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  if (!(session.provider instanceof SwiggyInstamartProvider) || !session.swiggyToken) {
    return c.json({ addresses: [], selected: undefined });
  }
  try {
    const addresses = await session.provider.listAddresses();
    if (!session.swiggyAddressId && addresses[0]) session.swiggyAddressId = addresses[0].id;
    return c.json({ addresses, selected: session.swiggyAddressId });
  } catch (err) {
    logger.warn('listing Swiggy addresses failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Could not load your Swiggy addresses — try again in a moment.' }, 502);
  }
});

/**
 * Payment methods for the current cart. COD is always offered; UPI apps / QR
 * appear only on the live provider with a connected account (get_cart never
 * includes UPI methods — get_payment_options is the only source).
 */
app.get('/api/payment/options', async (c) => {
  const sessionId = c.req.query('sessionId');
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  const codOnly = { codAvailable: true, upiApps: [], qrAvailable: false };
  if (!(session.provider instanceof SwiggyInstamartProvider) || !session.swiggyToken) {
    return c.json(codOnly);
  }
  try {
    return c.json(await session.provider.getPaymentOptions());
  } catch (err) {
    logger.warn('payment options failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Could not load payment methods. Please retry before placing an order.' }, 502);
  }
});

/**
 * One gentle poll of an in-flight UPI payment (the server call long-polls ~19s
 * on Swiggy's side). Passing orderId lets Swiggy auto-confirm on success.
 */
app.post('/api/payment/status', async (c) => {
  const body = await readJson<{ sessionId?: string; paasId?: unknown; orderId?: unknown }>(c);
  if (!body?.sessionId || typeof body.paasId !== 'string' || !body.paasId) {
    return c.json({ error: 'sessionId and paasId are required' }, 400);
  }
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  if (!(session.provider instanceof SwiggyInstamartProvider)) {
    return c.json({ error: 'payments are only available on the live provider' }, 400);
  }
  try {
    const orderId = typeof body.orderId === 'string' && body.orderId ? body.orderId : undefined;
    return c.json(await session.provider.checkPaymentStatus(body.paasId, orderId));
  } catch (err) {
    logger.warn('payment status check failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Could not check the payment status — try again in a moment.' }, 502);
  }
});

/** Poll-timeout fallback: finalize a PAID order stuck in PENDING_PAYMENT (idempotent). */
app.post('/api/payment/confirm', async (c) => {
  const body = await readJson<{ sessionId?: string; orderId?: unknown; paasId?: unknown }>(c);
  if (
    !body?.sessionId ||
    typeof body.orderId !== 'string' ||
    !body.orderId ||
    typeof body.paasId !== 'string' ||
    !body.paasId
  ) {
    return c.json({ error: 'sessionId, orderId and paasId are required' }, 400);
  }
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  if (!(session.provider instanceof SwiggyInstamartProvider)) {
    return c.json({ error: 'payments are only available on the live provider' }, 400);
  }
  try {
    return c.json(await session.provider.confirmPendingOrder(body.orderId, body.paasId));
  } catch (err) {
    logger.warn('payment confirm failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Could not confirm the payment — check the Swiggy app.' }, 502);
  }
});

/** Pin which saved address this session delivers to. */
app.post('/api/swiggy/address', async (c) => {
  const body = await readJson<{ sessionId?: string; addressId?: unknown }>(c);
  if (!body?.sessionId || typeof body.addressId !== 'string' || !body.addressId) {
    return c.json({ error: 'sessionId and addressId are required' }, 400);
  }
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);
  const addresses = await session.provider.listAddresses?.();
  if (!addresses?.some((address) => address.id === body.addressId)) {
    return c.json({ error: 'Choose a saved Swiggy address.' }, 400);
  }
  if (session.swiggyAddressId !== body.addressId) {
    session.carts.clear();
    session.lastCartId = undefined;
    session.manualSkuIds = undefined;
  }
  session.swiggyAddressId = body.addressId;
  // Fire-and-forget: an explicit pick should survive restarts alongside the token.
  if (session.userId) void saveAddress(session.userId, body.addressId);
  return c.json({ ok: true, selected: session.swiggyAddressId });
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
      if (!cartSeenThisTurn && /place order|review\s*(?:&|and)\s*pay/i.test(text)) {
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
    const returnTo = c.req.query('returnTo');
    if (returnTo && allowedOrigins.includes(returnTo)) session.returnTo = returnTo;
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
    // Fire-and-forget: persistence must never block or fail the connect flow.
    if (session.userId) void saveToken(session.userId, accessToken, session.swiggyTokenExpiresAt);
    logger.info('swiggy account connected to session', { sessionId });
    if (session.returnTo && allowedOrigins.includes(session.returnTo)) return c.redirect(session.returnTo);
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
<p style="margin:0;color:#8a7a66">${body}</p><p><a href="${escapeHtml(allowedOrigins[0] ?? '/')}">Return to Cookmate</a></p></div></body>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

/** The confirm gate as a UI action: tapping "Place order" arms the one-shot gate. */
app.post('/api/order', async (c) => {
  const body = await readJson<{
    sessionId?: string;
    cartId?: string;
    payment?: { method?: unknown; intentApp?: unknown; qr?: unknown };
  }>(c);
  if (!body?.sessionId || !body.cartId) return c.json({ error: 'sessionId and cartId are required' }, 400);
  const session = getSession(body.sessionId);
  if (!session) return c.json({ error: 'unknown or expired session' }, 404);

  if (session.lastCartId !== body.cartId) {
    return c.json({ error: 'This basket was updated. Review the latest basket before ordering.' }, 409);
  }
  if (body.payment?.method && !['upi', 'cod'].includes(String(body.payment.method))) {
    return c.json({ error: 'Choose an available payment method.' }, 400);
  }
  if (session.provider.getPaymentOptions) {
    const options = await session.provider.getPaymentOptions();
    const valid =
      body.payment?.method === 'upi'
        ? typeof body.payment.intentApp === 'string'
          ? options.upiApps.some((a) => a.id === body.payment?.intentApp)
          : options.qrAvailable
        : options.codAvailable;
    if (!valid)
      return c.json({ error: 'That payment method is unavailable. Review payment options again.' }, 400);
  }
  // The payment choice comes from the order UI, never the model; malformed
  // input degrades to COD (the safe default) rather than erroring the gate.
  const payment =
    body.payment?.method === 'upi'
      ? {
          method: 'upi' as const,
          ...(typeof body.payment.intentApp === 'string' && body.payment.intentApp
            ? { intentApp: body.payment.intentApp }
            : { qr: true }),
        }
      : undefined;

  // Arm the one-shot gate for exactly this cart; the executor's confirm hook
  // consumes it and verifies the cartId matches before any money moves.
  session.armedCartId = body.cartId;
  try {
    const res = await session.execute('place_order', {
      cart_id: body.cartId,
      ...(payment ? { payment } : {}),
    });
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

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/server/index.ts')) {
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
}
