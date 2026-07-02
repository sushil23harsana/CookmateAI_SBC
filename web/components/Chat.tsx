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
import OrderCard from './OrderCard';

let counter = 0;
const uid = () => `${Date.now()}-${counter++}`;

export default function Chat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string | null>(null);

  // Restore the conversation across reloads (saved when idle below).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cookmate_items');
      if (saved) setItems(JSON.parse(saved));
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
          onCart: (cart: Cart) => push({ id: uid(), kind: 'cart', role: 'assistant', cart, ordered: false }),
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
          <span className="dot" /> Instamart
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

      <Composer onSend={send} busy={busy} />
      </div>
    </MotionConfig>
  );
}
