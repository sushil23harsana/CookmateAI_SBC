import type { Cart, OrderResult, TrackResult } from './types';

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

export async function createSession(): Promise<string> {
  const r = await fetch(`${BASE}/api/session`, { method: 'POST' });
  if (!r.ok) throw new Error('Could not start a session');
  const { sessionId } = (await r.json()) as { sessionId: string };
  return sessionId;
}

export interface ChatHandlers {
  onStatus?: (phase: string, tool?: string) => void;
  onCart?: (cart: Cart) => void;
  onDelta?: (delta: string) => void;
  onMessage?: (text: string) => void;
  onError?: (message: string) => void;
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

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      dispatch(raw, h);
    }
  }
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
  }
}

export async function placeOrder(
  sessionId: string,
  cartId: string,
): Promise<{ placed: boolean; order?: OrderResult; error?: string; reason?: string }> {
  const r = await fetch(`${BASE}/api/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, cartId }),
  });
  return r.json();
}

export async function trackOrder(sessionId: string, orderId: string): Promise<TrackResult> {
  const r = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, orderId }),
  });
  if (!r.ok) return { orderId, status: 'UNKNOWN' };
  return r.json();
}
