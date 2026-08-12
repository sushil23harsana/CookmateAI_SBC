'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import * as api from '@/lib/api';
import type { Cart, ChatItem, Phase } from '@/lib/types';
import Welcome from './Welcome';
import Composer from './Composer';
import MessageBubble from './MessageBubble';
import WorkingState from './WorkingState';
import CartCard from './CartCard';
import CartDock from './CartDock';
import OrderCard from './OrderCard';

let counter = 0;
const uid = () => `${Date.now()}-${counter++}`;

export default function Chat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [busy, setBusy] = useState(false);
  // The most recent reviewed cart, surfaced in a sticky bar so the Place order
  // action is always reachable even when the cart card has scrolled far up.
  const [latestCart, setLatestCart] = useState<Cart | null>(null);
  const [latestOrdered, setLatestOrdered] = useState(false);
  // Live-provider auth: whether THIS visitor has connected their own Swiggy
  // account. On mock the banner never shows (provider comes back as 'mock').
  const [swiggy, setSwiggy] = useState<api.SwiggyStatus | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string | null>(null);

  // Restore the conversation across reloads (saved when idle below).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cookmate_items');
      if (saved) {
        const parsed = JSON.parse(saved) as ChatItem[];
        setItems(parsed);
        // Prefer the saved dock state: manual +/- edits produce carts that
        // never appear as cards in the stream.
        const dock = localStorage.getItem('cookmate_dock');
        const d = dock ? (JSON.parse(dock) as { cart?: Cart; ordered?: boolean }) : null;
        const lastCart = d?.cart
          ? { cart: d.cart, ordered: !!d.ordered }
          : [...parsed].reverse().find((it) => it.kind === 'cart' && it.cart);
        if (lastCart?.cart) {
          setLatestCart(lastCart.cart);
          setLatestOrdered(!!lastCart.ordered);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (busy) return;
    try {
      localStorage.setItem('cookmate_items', JSON.stringify(items.slice(-50)));
    } catch {
      /* ignore */
    }
  }, [items, busy]);

  useEffect(() => {
    if (!latestCart) return;
    try {
      localStorage.setItem('cookmate_dock', JSON.stringify({ cart: latestCart, ordered: latestOrdered }));
    } catch {
      /* ignore */
    }
  }, [latestCart, latestOrdered]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('cookmate_session') : null;
    if (saved) {
      setSessionId(saved);
      return;
    }
    api
      .createSession()
      .then((id) => {
        localStorage.setItem('cookmate_session', id);
        setSessionId(id);
      })
      .catch(() => {});
  }, []);

  // Check connection state when the session is known, and again whenever the tab
  // regains focus — that's the moment the user returns from Swiggy's approval page.
  const refreshSwiggy = useCallback(() => {
    if (!sessionId) return;
    api
      .swiggyStatus(sessionId)
      .then((st) => {
        if (!st.known) {
          // The saved session died with a server restart — mint a fresh one;
          // the durable user id restores any persisted Swiggy connection.
          api
            .createSession()
            .then((id) => {
              localStorage.setItem('cookmate_session', id);
              setSessionId(id);
            })
            .catch(() => {});
          return;
        }
        setSwiggy(st);
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    refreshSwiggy();
    window.addEventListener('focus', refreshSwiggy);
    return () => window.removeEventListener('focus', refreshSwiggy);
  }, [refreshSwiggy]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items, phase]);

  const push = (it: ChatItem) => setItems((p) => [...p, it]);

  async function freshSession(): Promise<string> {
    const id = await api.createSession();
    localStorage.setItem('cookmate_session', id);
    setSessionId(id);
    return id;
  }

  const send = useCallback(
    async (text: string) => {
      if (busy) return;
      const sid = sessionId ?? (await freshSession().catch(() => null));
      if (!sid) {
        push({ id: uid(), kind: 'text', role: 'assistant', text: 'I could not reach the kitchen — is the server running?' });
        return;
      }
      push({ id: uid(), kind: 'text', role: 'user', text });
      setBusy(true);
      setPhase('recipe');
      streamingIdRef.current = null;
      try {
        await api.chat(sid, text, {
          onStatus: (p) => {
            // A tool phase began — close any in-progress streamed bubble so later
            // text (e.g. the post-cart summary) lands as its own message below the cart.
            const id = streamingIdRef.current;
            if (id) {
              streamingIdRef.current = null;
              setItems((prev) => prev.map((it) => (it.id === id ? { ...it, streaming: false } : it)));
            }
            setPhase(p as Phase);
          },
          onCart: (cart: Cart) => {
            push({ id: uid(), kind: 'cart', role: 'assistant', cart, ordered: false });
            setLatestCart(cart);
            setLatestOrdered(false);
          },
          onDelta: (delta) => {
            setPhase(null); // the model is answering now — hand off from the working state
            if (!streamingIdRef.current) {
              const id = uid();
              streamingIdRef.current = id;
              push({ id, kind: 'text', role: 'assistant', text: delta, streaming: true });
            } else {
              const id = streamingIdRef.current;
              setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text: (it.text ?? '') + delta } : it)));
            }
          },
          onMessage: (t) => {
            const id = streamingIdRef.current;
            streamingIdRef.current = null;
            if (id) {
              setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text: t, streaming: false } : it)));
            } else if (t.trim()) {
              push({ id: uid(), kind: 'text', role: 'assistant', text: t });
            }
          },
          onError: (m) => {
            streamingIdRef.current = null;
            push({ id: uid(), kind: 'text', role: 'assistant', text: m });
          },
        });
      } catch (err) {
        streamingIdRef.current = null;
        if (err instanceof api.ApiError && err.status !== 404) {
          // Busy (409), rate-limited (429), too long (413) — the session is fine;
          // surface the server's friendly message as the reply.
          push({ id: uid(), kind: 'text', role: 'assistant', text: err.message });
        } else {
          // Network failure or expired session (server restart) — start fresh.
          await freshSession().catch(() => {});
          push({
            id: uid(),
            kind: 'text',
            role: 'assistant',
            text: 'I lost the thread there — mind sending that once more?',
          });
        }
      } finally {
        setBusy(false);
        setPhase(null);
      }
    },
    [busy, sessionId],
  );

  const placeOrder = async (cart: Cart) => {
    if (!sessionId) return;
    const res = await api.placeOrder(sessionId, cart.cartId);
    if (res.placed && res.order) {
      setItems((p) =>
        p.map((it) => (it.kind === 'cart' && it.cart?.cartId === cart.cartId ? { ...it, ordered: true } : it)),
      );
      setLatestOrdered((prev) => (latestCart?.cartId === cart.cartId ? true : prev));
      push({ id: uid(), kind: 'order', role: 'assistant', order: res.order });
    } else {
      push({
        id: uid(),
        kind: 'text',
        role: 'assistant',
        text: res.error || res.reason || 'That didn’t go through — let’s try again.',
      });
    }
  };

  // +/- steppers: rebuild the sku list with the new quantity and have the
  // server re-review it — the fresh authoritative snapshot replaces the dock cart.
  const changeQty = async (skuId: string, qty: number) => {
    if (!sessionId || !latestCart) return;
    const skuIds = latestCart.lines.flatMap((l) =>
      Array<string>(Math.max(0, l.id === skuId ? qty : l.qty)).fill(l.id),
    );
    if (skuIds.length === 0) return; // a cart can't be reviewed empty
    try {
      const res = await api.updateCart(sessionId, skuIds);
      if (res.cart) {
        setLatestCart(res.cart);
        setLatestOrdered(false);
      }
    } catch (err) {
      push({
        id: uid(),
        kind: 'text',
        role: 'assistant',
        text: err instanceof api.ApiError ? err.message : 'I could not update the cart — mind telling me instead?',
      });
    }
  };

  const track = async (orderId: string): Promise<string> => {
    if (!sessionId) return orderId;
    const r = await api.trackOrder(sessionId, orderId);
    return r.status;
  };

  const empty = items.length === 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <circle cx="11" cy="13" r="6.6" fill="#fff" />
              <circle cx="11" cy="13" r="3.3" fill="#f4a23e" />
              <rect x="17" y="11.4" width="6.4" height="3.1" rx="1.5" fill="#fff" />
            </svg>
          </div>
          <div className="brand-name">
            Cook<em>mate</em>
          </div>
        </div>
        <div className="status-chip">
          <span className="dot" />{' '}
          {swiggy?.provider === 'swiggy' ? (swiggy.connected ? 'Swiggy · connected' : 'Swiggy') : 'Instamart'}
        </div>
      </header>

      <div className="stream" ref={streamRef} role="log" aria-live="polite" aria-relevant="additions text">
        {empty ? <Welcome onPick={send} /> : null}
        {items.map((it) => {
          if (it.kind === 'cart' && it.cart) {
            const cart = it.cart;
            return <CartCard key={it.id} cart={cart} ordered={!!it.ordered} onPlace={() => placeOrder(cart)} />;
          }
          if (it.kind === 'order' && it.order) {
            const order = it.order;
            return <OrderCard key={it.id} order={order} onTrack={() => track(order.orderId)} />;
          }
          return <MessageBubble key={it.id} item={it} />;
        })}
        <AnimatePresence>{phase ? <WorkingState key="working" phase={phase} /> : null}</AnimatePresence>
      </div>

      {swiggy?.provider === 'swiggy' && !swiggy.connected && sessionId ? (
        <div className="connectbar">
          <span className="connectbar-text">
            🔐 Link your own Swiggy account — orders go to <strong>your</strong> address and payment.
          </span>
          <a
            className="connectbtn"
            href={api.swiggyConnectUrl(sessionId)}
            target="_blank"
            rel="noreferrer"
          >
            Connect Swiggy
          </a>
        </div>
      ) : null}

      {latestCart && !latestOrdered ? (
        <CartDock cart={latestCart} busy={busy} onPlace={placeOrder} onChangeQty={changeQty} />
      ) : null}

      <Composer onSend={send} busy={busy} />
      </div>
    </MotionConfig>
  );
}
