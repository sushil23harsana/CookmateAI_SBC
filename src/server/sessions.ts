import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { createLlm } from '../llm/factory.js';
import type { ChatLlm } from '../llm/llm.js';
import { systemPrompt } from '../llm/prompt.js';
import { CartStore } from '../core/cart.js';
import { MemoryPantry } from '../core/pantry.js';
import { createExecutor, toolDefs, type Executor } from '../engine/executor.js';
import { MockInstamartProvider } from '../instamart/mock.js';
import { SwiggyInstamartProvider } from '../instamart/swiggyMcp.js';
import type { InstamartProvider } from '../instamart/provider.js';
import type { Cart } from '../types.js';

/**
 * One in-memory Session per browser tab: its own agent, cart store, provider, and
 * an event bus the chat SSE stream subscribes to for live phase + cart events.
 * (Production would persist this per authenticated user; in-memory is fine for v1.)
 */
export interface Session {
  id: string;
  /**
   * Anonymous durable id from the browser (random uuid in localStorage — no
   * PII). Keys the persisted Swiggy token, so a returning user is still
   * connected after this in-memory session is long gone.
   */
  userId?: string;
  provider: InstamartProvider;
  carts: CartStore;
  execute: Executor;
  agent: ChatLlm;
  bus: EventEmitter;
  /**
   * One-shot confirm gate: holds the cartId the user just approved by tapping
   * "Place order". Consumed on first check and matched against the exact cart
   * being placed, so a concurrent model-issued place_order can never ride an
   * armed gate — for this cart or any other.
   */
  armedCartId?: string;
  /** True while a chat turn is running — the agent conversation is not reentrant. */
  busy: boolean;
  lastCartId?: string;
  /**
   * Set when the user adjusts quantities with the cart's +/- buttons (a
   * server-side re-review the model never saw). Consumed by the next chat
   * turn, which tells the model the current list so it doesn't revert edits.
   */
  manualSkuIds?: string[];
  /**
   * THIS user's Swiggy bearer token, minted when they approved the OAuth flow.
   * Strictly per-session — orders go to the connected account's address and
   * money, never the operator's. Dies with the session (5-day token, no refresh).
   */
  swiggyToken?: string;
  swiggyTokenExpiresAt?: number;
  /** The saved Swiggy address the user picked — availability and prices follow it. */
  swiggyAddressId?: string;
  createdAt: number;
  lastSeenAt: number;
}

const sessions = new Map<string, Session>();

/** Map a tool name to a UI animation phase. */
const PHASE: Record<string, string> = {
  get_pantry: 'pantry',
  search_items: 'searching',
  optimize_budget: 'budget',
  review_cart: 'cart',
  place_order: 'ordering',
  track_order: 'tracking',
};

export function createSession(userId?: string): Session {
  evictIfFull();
  const id = randomUUID();
  const carts = new CartStore();
  const bus = new EventEmitter();

  const now = Date.now();
  const session = {
    id,
    userId,
    carts,
    bus,
    busy: false,
    createdAt: now,
    lastSeenAt: now,
  } as Session;

  // The swiggy provider reads THIS session's token on every connect, so it only
  // ever acts as the user who approved the OAuth flow in this session.
  const provider: InstamartProvider =
    config.provider === 'swiggy'
      ? new SwiggyInstamartProvider(
          () => session.swiggyToken ?? '',
          () => session.swiggyAddressId,
        )
      : new MockInstamartProvider();
  session.provider = provider;

  session.execute = createExecutor({
    provider,
    carts,
    pantry: new MemoryPantry(), // per-session: one user's pantry never leaks to another
    confirmOrder: async (cart) => {
      const armed = session.armedCartId;
      session.armedCartId = undefined; // one-shot: consumed even on mismatch
      return armed === cart.cartId;
    },
    onCartReviewed: (cart: Cart) => {
      session.lastCartId = cart.cartId;
      bus.emit('cart', cart);
    },
    onOrderPlaced: (order, cart) => bus.emit('order', { order, cart }),
  });

  session.agent = createLlm({
    system: systemPrompt('web'),
    tools: toolDefs(),
    execute: session.execute,
    maxIterations: config.maxToolIterations,
    events: {
      onToolCall: (name) => bus.emit('status', { phase: PHASE[name] ?? 'thinking', tool: name }),
      onTextDelta: (delta) => bus.emit('delta', delta),
    },
  });

  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (s) s.lastSeenAt = Date.now();
  return s;
}

export function sessionCount(): number {
  return sessions.size;
}

/** Evict the least-recently-used session when at capacity. */
function evictIfFull(): void {
  if (sessions.size < config.maxSessions) return;
  let oldestId: string | undefined;
  let oldest = Infinity;
  for (const [id, s] of sessions) {
    if (s.lastSeenAt < oldest) {
      oldest = s.lastSeenAt;
      oldestId = id;
    }
  }
  if (oldestId) {
    const s = sessions.get(oldestId);
    sessions.delete(oldestId);
    void s?.provider.close().catch(() => {});
  }
}

/** Drop idle sessions past their TTL. Returns how many were removed. */
export function sweepExpiredSessions(): number {
  const cutoff = Date.now() - config.sessionTtlMs;
  let removed = 0;
  for (const [id, s] of sessions) {
    if (s.lastSeenAt < cutoff) {
      sessions.delete(id);
      void s.provider.close().catch(() => {});
      removed += 1;
    }
  }
  return removed;
}
