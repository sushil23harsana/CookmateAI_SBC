import type { Cart, OrderResult, TrackResult, PaymentOptions, PaymentStatus } from './types';

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787';

/** A non-OK API response, carrying the server's friendly error message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let msg = 'Something went wrong.';
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) msg = body.error;
  } catch {
    /* non-JSON body */
  }
  return new ApiError(msg, res.status);
}

let creatingSession: Promise<string> | null = null;
export function createSession(): Promise<string> {
  creatingSession ??= requestSession().finally(() => {
    creatingSession = null;
  });
  return creatingSession;
}

async function requestSession(): Promise<string> {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resumeToken: localStorage.getItem('cookmate_resume') }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error('Could not start a session');
  const { sessionId, resumeToken } = (await r.json()) as { sessionId: string; resumeToken: string };
  localStorage.setItem('cookmate_resume', resumeToken);
  localStorage.setItem('cookmate_session_v2', sessionId);
  return sessionId;
}

export interface ChatHandlers {
  onStatus?: (phase: string, tool?: string) => void;
  onCart?: (cart: Cart) => void;
  onDelta?: (delta: string) => void;
  onMessage?: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/** POST a message and consume the SSE stream (fetch + manual parser, since EventSource can't POST). */
export async function chat(sessionId: string, message: string, h: ChatHandlers): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
  // Non-OK means a JSON error (expired session, busy, rate limit), not an SSE
  // stream — without this check the message would vanish with no reply at all.
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new Error('No response stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  const handlers = {
    ...h,
    onDone: () => {
      complete = true;
      h.onDone?.();
    },
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      dispatch(raw, handlers);
    }
  }
  if (!complete)
    throw new Error('The reply was interrupted. Your draft is saved; try again when the connection returns.');
}

function dispatch(raw: string, h: ChatHandlers): void {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }
  switch (event) {
    case 'status':
      h.onStatus?.(String(payload.phase ?? 'thinking'), payload.tool as string | undefined);
      break;
    case 'cart':
      h.onCart?.(payload as unknown as Cart);
      break;
    case 'delta':
      h.onDelta?.(String(payload.delta ?? ''));
      break;
    case 'message':
      h.onMessage?.(String(payload.text ?? ''));
      break;
    case 'error':
      h.onError?.(String(payload.message ?? 'Something went wrong.'));
      break;
    case 'done':
      h.onDone?.();
      break;
  }
}

export interface SwiggyStatus {
  provider: string;
  /** False when the session id is unknown to the server (restart / TTL). */
  known: boolean;
  connected: boolean;
  chatAllowed: boolean;
  expiresAt?: string;
}

/** Whether THIS session's user has connected their Swiggy account. */
export async function swiggyStatus(sessionId: string): Promise<SwiggyStatus> {
  const r = await fetch(`${BASE}/api/swiggy/status?sessionId=${encodeURIComponent(sessionId)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

/** Where the "Connect Swiggy" button sends the user (their approval, their account). */
export const swiggyConnectUrl = (sessionId: string): string =>
  `${BASE}/oauth/start?session=${encodeURIComponent(sessionId)}&returnTo=${encodeURIComponent(window.location.origin)}`;

export interface SwiggyAddress {
  id: string;
  label: string;
}

/** The connected user's saved Swiggy addresses + which one this session delivers to. */
export async function swiggyAddresses(
  sessionId: string,
): Promise<{ addresses: SwiggyAddress[]; selected?: string }> {
  const r = await fetch(`${BASE}/api/swiggy/addresses?sessionId=${encodeURIComponent(sessionId)}`);
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

/** Pin the delivery address — availability and prices follow it. */
export async function setSwiggyAddress(sessionId: string, addressId: string): Promise<void> {
  const r = await fetch(`${BASE}/api/swiggy/address`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, addressId }),
  });
  if (!r.ok) throw await errorFrom(r);
}

/** Re-review the cart server-side with a new sku list (repeat an id for qty > 1). */
export async function updateCart(sessionId: string, skuIds: string[]): Promise<{ cart?: Cart }> {
  const r = await fetch(`${BASE}/api/cart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, skuIds }),
  });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

export interface PaymentChoice {
  method: 'cod' | 'upi';
  intentApp?: string;
  qr?: boolean;
}

export async function placeOrder(
  sessionId: string,
  cartId: string,
  payment?: PaymentChoice,
): Promise<{ placed: boolean; order?: OrderResult; error?: string; reason?: string }> {
  const r = await fetch(`${BASE}/api/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, cartId, ...(payment ? { payment } : {}) }),
  });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

/** Payment methods for the current cart (COD-only unless connected to Swiggy). */
export async function paymentOptions(sessionId: string): Promise<PaymentOptions> {
  const r = await fetch(`${BASE}/api/payment/options?sessionId=${encodeURIComponent(sessionId)}`);
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

/** One gentle status read of an in-flight UPI payment (server long-polls Swiggy). */
export async function paymentStatus(
  sessionId: string,
  paasId: string,
  orderId?: string,
): Promise<PaymentStatus> {
  const r = await fetch(`${BASE}/api/payment/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, paasId, ...(orderId ? { orderId } : {}) }),
  });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

/** Poll-timeout fallback: finalize a PAID order stuck pending (idempotent). */
export async function paymentConfirm(
  sessionId: string,
  orderId: string,
  paasId: string,
): Promise<PaymentStatus> {
  const r = await fetch(`${BASE}/api/payment/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, orderId, paasId }),
  });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

export async function trackOrder(sessionId: string, orderId: string): Promise<TrackResult> {
  const r = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, orderId }),
  });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

let initializing: Promise<string> | null = null;
export function ensureSession(): Promise<string> {
  if (initializing) return initializing;
  initializing = (async () => {
    const saved = localStorage.getItem('cookmate_session_v2');
    if (saved) {
      const status = await swiggyStatus(saved);
      if (status.known) return saved;
    }
    return createSession();
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

export async function sessionAction(
  sessionId: string,
  action: 'swiggy/disconnect' | 'shop/reset',
): Promise<void> {
  const response = await fetch(`${BASE}/api/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw await errorFrom(response);
}
