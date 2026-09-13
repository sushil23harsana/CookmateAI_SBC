'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import * as api from '@/lib/api';
import type { Cart, ChatItem, OrderResult, PaymentOptions, Phase } from '@/lib/types';
import Welcome from './Welcome';
import Composer from './Composer';
import MessageBubble from './MessageBubble';
import WorkingState from './WorkingState';
import CartCard from './CartCard';
import CartDock from './CartDock';
import OrderCard from './OrderCard';
import PaymentFlow from './PaymentFlow';

const uid = () => crypto.randomUUID();
type Payment = { cart: Cart; options: PaymentOptions; pending?: OrderResult; uncertain?: boolean };
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export default function Chat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [swiggy, setSwiggy] = useState<api.SwiggyStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [busy, setBusy] = useState(false);
  const [latestCart, setLatestCart] = useState<Cart | null>(null);
  const [latestOrdered, setLatestOrdered] = useState(false);
  const [addresses, setAddresses] = useState<api.SwiggyAddress[]>([]);
  const [addressId, setAddressId] = useState<string>();
  const [payFlow, setPayFlow] = useState<Payment | null>(null);
  const [pendingPayment, setPendingPayment] = useState<Payment | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const actionRef = useRef(false);
  const refreshing = useRef(false);
  const ready = swiggy?.chatAllowed === true;
  const locked = busy || Boolean(payFlow) || Boolean(pendingPayment);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cookmate_shop_v2') ?? 'null');
      if (saved) {
        if (Array.isArray(saved.items)) setItems(saved.items.filter((it: ChatItem) => !it.streaming));
        if (typeof saved.draft === 'string') setDraft(saved.draft);
        if (saved.pending) setPendingPayment(saved.pending);
        // Old quotes are history after a reload; never silently recreate an actionable order.
      }
    } catch {
      /* local storage may be unavailable */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || busy) return;
    try {
      localStorage.setItem(
        'cookmate_shop_v2',
        JSON.stringify({ items: items.slice(-50), draft, pending: pendingPayment }),
      );
    } catch {
      /* storage is optional */
    }
  }, [items, draft, hydrated, busy, pendingPayment]);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setChecking(true);
    try {
      const id = await api.ensureSession();
      setSessionId(id);
      const status = await api.swiggyStatus(id);
      setSwiggy(status);
      setNotice(null);
      if (status.connected) {
        const data = await api.swiggyAddresses(id);
        setAddresses(data.addresses);
        setAddressId(data.selected);
        if (!data.addresses.length)
          setNotice('Add a delivery address in the Swiggy app, then check your connection again.');
      }
    } catch (error) {
      setSwiggy(null);
      setNotice(message(error));
    } finally {
      setChecking(false);
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => {
      if (!actionRef.current) void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const connect = async () => {
    if (connecting || actionRef.current) return;
    setConnecting(true);
    setNotice(null);
    try {
      const id = await api.createSession();
      setSessionId(id);
      window.location.assign(api.swiggyConnectUrl(id));
    } catch (error) {
      setNotice(message(error));
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!sessionId || locked) return;
    setBusy(true);
    try {
      await api.sessionAction(sessionId, 'swiggy/disconnect');
      [
        'cookmate_resume',
        'cookmate_session_v2',
        'cookmate_shop_v2',
        'cookmate_user',
        'cookmate_items',
        'cookmate_dock',
        'cookmate_session',
      ].forEach((key) => localStorage.removeItem(key));
      setSwiggy(null);
      setSessionId(null);
      setItems([]);
      setLatestCart(null);
      setDraft('');
      setAddresses([]);
      setNotice('Disconnected. Your saved Cookmate connection and local conversation have been removed.');
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  };

  const pickAddress = async (id: string) => {
    if (!sessionId || locked || actionRef.current) return;
    actionRef.current = true;
    setBusy(true);
    try {
      await api.setSwiggyAddress(sessionId, id);
      setAddressId(id);
      setLatestCart(null);
      setNotice(
        'Delivery address updated. Ask Cookmate to rebuild your basket with prices for this address.',
      );
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
      actionRef.current = false;
    }
  };

  useEffect(() => {
    if (items.length > 0 && nearBottom.current)
      streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'instant' });
  }, [items, phase]);

  const push = (item: ChatItem) => setItems((previous) => [...previous, item]);
  const send = async (text: string) => {
    if (!ready || !sessionId || locked || actionRef.current) return;
    actionRef.current = true;
    nearBottom.current = true;
    setBusy(true);
    setNotice(null);
    setDraft('');
    setPhase('recipe');
    push({ id: uid(), kind: 'text', role: 'user', text });
    let streamingId: string | null = null;
    const finishBubble = () => {
      if (streamingId) {
        const id = streamingId;
        setItems((previous) =>
          previous.map((item) => (item.id === id ? { ...item, streaming: false } : item)),
        );
        streamingId = null;
      }
    };
    try {
      await api.chat(sessionId, text, {
        onStatus: (value) => {
          finishBubble();
          setPhase(value as Phase);
        },
        onCart: (cart) => {
          push({ id: uid(), kind: 'cart', role: 'assistant', cart });
          setLatestCart(cart);
          setLatestOrdered(false);
        },
        onDelta: (delta) => {
          setPhase(null);
          if (!streamingId) {
            streamingId = uid();
            push({ id: streamingId, kind: 'text', role: 'assistant', text: delta, streaming: true });
          } else {
            const id = streamingId;
            setItems((previous) =>
              previous.map((item) => (item.id === id ? { ...item, text: (item.text ?? '') + delta } : item)),
            );
          }
        },
        onMessage: (reply) => {
          const id = streamingId;
          streamingId = null;
          if (id)
            setItems((previous) =>
              previous.map((item) => (item.id === id ? { ...item, text: reply, streaming: false } : item)),
            );
          else if (reply.trim()) push({ id: uid(), kind: 'text', role: 'assistant', text: reply });
        },
        onError: (error) => {
          finishBubble();
          setNotice(error);
          setDraft(text);
        },
      });
    } catch (error) {
      finishBubble();
      setNotice(message(error));
      setDraft(text);
      if (error instanceof api.ApiError && [401, 404, 503].includes(error.status)) setSwiggy(null);
    } finally {
      setBusy(false);
      setPhase(null);
      actionRef.current = false;
    }
  };

  const placeOrder = async (cart: Cart) => {
    if (!sessionId || !ready || locked || actionRef.current || cart.cartId !== latestCart?.cartId) return;
    actionRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const options = await api.paymentOptions(sessionId);
      if (!options.codAvailable && !options.qrAvailable && !options.upiApps.length)
        throw new Error('No payment method is available for this basket. Check Swiggy or try again later.');
      setPayFlow({ cart, options });
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
      actionRef.current = false;
    }
  };

  const changeQty = async (skuId: string, qty: number) => {
    if (!sessionId || !latestCart || locked || actionRef.current) return;
    actionRef.current = true;
    setBusy(true);
    setNotice(null);
    const ids = latestCart.lines.flatMap((line) =>
      Array<string>(Math.max(0, line.id === skuId ? qty : line.qty)).fill(line.id),
    );
    try {
      if (!ids.length) {
        await api.sessionAction(sessionId, 'shop/reset');
        setLatestCart(null);
        return;
      }
      const result = await api.updateCart(sessionId, ids);
      if (!result.cart)
        throw new Error('Could not price this basket. Ask Cookmate to check product availability again.');
      const fresh = result.cart;
      setLatestCart(fresh);
      setLatestOrdered(false);
      setItems((previous) =>
        previous.map((item) => (item.cart?.cartId === latestCart.cartId ? { ...item, cart: fresh } : item)),
      );
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
      actionRef.current = false;
    }
  };

  const orderPlaced = (cart: Cart, order: OrderResult) => {
    setItems((previous) =>
      previous.map((item) => (item.cart?.cartId === cart.cartId ? { ...item, ordered: true } : item)),
    );
    setLatestOrdered(true);
    setPayFlow(null);
    setPendingPayment(null);
    push({ id: uid(), kind: 'order', role: 'assistant', order });
  };

  const recordPayment = (payment: Payment) => {
    // Persist before checkout starts so a reload cannot hide an in-flight attempt.
    localStorage.setItem(
      'cookmate_shop_v2',
      JSON.stringify({ items: items.slice(-50), draft, pending: payment }),
    );
    setPendingPayment(payment);
  };

  const reset = async () => {
    if (!sessionId || locked) return;
    setBusy(true);
    try {
      await api.sessionAction(sessionId, 'shop/reset');
      setItems([]);
      setLatestCart(null);
      setDraft('');
      setNotice(null);
      setConfirmReset(false);
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={`app app-v2 ${items.length ? 'has-conversation' : ''}`}>
        <header className="topbar">
          <a className="brand" href="/" aria-label="Cookmate home">
            <span className="brand-mark" aria-hidden="true">
              c<span>·</span>
            </span>
            <span className="brand-name">
              cook<em>mate</em>
            </span>
          </a>
          <nav className="topbar-right" aria-label="Account and help">
            <a className="help-link" href="/help">
              Help
            </a>
            {ready ? (
              <>
                <span className={`status-chip ${swiggy?.provider === 'mock' ? 'demo-chip' : ''}`}>
                  {swiggy?.provider === 'mock' ? 'Demo · no real orders' : '✓ Swiggy connected'}
                </span>
                <button
                  className="text-action account-action"
                  disabled={locked}
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className="connectbtn" onClick={() => void connect()} disabled={connecting}>
                {connecting ? 'Opening…' : 'Connect Swiggy'} <span aria-hidden="true">↗</span>
              </button>
            )}
          </nav>
        </header>
        <div className="shop-layout">
          <main className="conversation">
            {ready && swiggy?.connected ? (
              <div className="delivery-bar">
                <span>Deliver to</span>
                <select
                  value={addressId ?? ''}
                  onChange={(event) => void pickAddress(event.target.value)}
                  disabled={locked || !addresses.length}
                  aria-label="Delivery address"
                >
                  {!addresses.length ? (
                    <option>No address available</option>
                  ) : (
                    addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}
            {notice ? (
              <div className="app-notice" role="status">
                <span>{notice}</span>
                <button className="text-action" disabled={busy || checking} onClick={() => void refresh()}>
                  Check connection
                </button>
                <button
                  className="notice-dismiss"
                  aria-label="Dismiss message"
                  onClick={() => setNotice(null)}
                >
                  ×
                </button>
              </div>
            ) : null}
            {items.length > 0 ? (
              <div className="conversation-heading">
                <span>Your kitchen conversation</span>
                <button
                  className="text-action"
                  disabled={locked || !ready}
                  onClick={() => setConfirmReset(true)}
                >
                  + New shop
                </button>
              </div>
            ) : null}
            {confirmReset ? (
              <div className="app-notice">
                <span>Start a new conversation and clear this basket?</span>
                <button className="text-action" onClick={() => void reset()} disabled={locked}>
                  Start fresh
                </button>
                <button className="text-action" onClick={() => setConfirmReset(false)}>
                  Keep shopping
                </button>
              </div>
            ) : null}
            <div
              className="stream"
              ref={streamRef}
              onScroll={() => {
                const element = streamRef.current;
                if (element)
                  nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 180;
              }}
            >
              {!items.length ? (
                <Welcome
                  ready={ready}
                  connecting={connecting}
                  onConnect={() => void connect()}
                  onPick={(text) => {
                    setDraft(text);
                    if (!ready)
                      setNotice('Idea saved below. Connect Swiggy, then send it when you’re ready.');
                  }}
                />
              ) : null}
              <div className="message-list" role="log" aria-live="polite" aria-relevant="additions text">
                {items.map((item) =>
                  item.kind === 'cart' && item.cart ? (
                    <CartCard
                      key={item.id}
                      cart={item.cart}
                      ordered={!!item.ordered}
                      active={ready && latestCart?.cartId === item.cart.cartId && !latestOrdered}
                      demo={swiggy?.provider === 'mock'}
                      busy={locked}
                      onPlace={() => placeOrder(item.cart!)}
                    />
                  ) : item.kind === 'order' && item.order ? (
                    <OrderCard
                      key={item.id}
                      order={item.order}
                      onTrack={async () => {
                        if (!sessionId) throw new Error('Reconnect to check your order.');
                        return (await api.trackOrder(sessionId, item.order!.orderId)).status;
                      }}
                    />
                  ) : (
                    <MessageBubble key={item.id} item={item} />
                  ),
                )}
                <AnimatePresence>
                  {phase ? <WorkingState key="working" phase={phase} /> : null}
                </AnimatePresence>
              </div>
            </div>
            {pendingPayment ? (
              <div className="app-notice">
                <span>A payment needs checking. Don’t place another order yet.</span>
                <button className="text-action" disabled={!ready} onClick={() => setPayFlow(pendingPayment)}>
                  Check payment
                </button>
                {pendingPayment.uncertain ? (
                  <button
                    className="text-action"
                    onClick={() => {
                      setPendingPayment(null);
                      setLatestCart(null);
                      setNotice(
                        'Ask Cookmate to review a fresh basket only if Swiggy shows no order or payment pending.',
                      );
                    }}
                  >
                    I’ve checked in Swiggy
                  </button>
                ) : null}
              </div>
            ) : null}
            <Composer
              text={draft}
              onChange={setDraft}
              onSend={(text) => void send(text)}
              busy={locked || connecting}
              locked={!ready}
              onConnect={() => void connect()}
            />
          </main>
          {items.length > 0 ? (
            <aside className="basket-sidebar" aria-label="Current basket">
              <div className="sidebar-title">
                <span>Your basket</span>
                <span className="eyebrow">INSTAMART</span>
              </div>
              {latestCart && !latestOrdered ? (
                <CartDock
                  cart={latestCart}
                  busy={locked || !ready}
                  onPlace={placeOrder}
                  onChangeQty={changeQty}
                />
              ) : (
                <div className="basket-empty">
                  <span aria-hidden="true">🧺</span>
                  <h2>{latestOrdered ? 'You’re all set.' : 'A little room for good things.'}</h2>
                  <p>
                    {latestOrdered
                      ? 'Your order details are in the conversation.'
                      : 'Your current basket will appear here. Ask for a meal or send your grocery list.'}
                  </p>
                  {items.some((item) => item.cart) && !latestOrdered ? (
                    <p>Saved baskets are history. Ask Cookmate to check today’s prices before ordering.</p>
                  ) : null}
                </div>
              )}
              <div className="sidebar-note">
                Built with Swiggy Instamart.
                <br />
                You review every basket before ordering.
              </div>
            </aside>
          ) : null}
        </div>
        {payFlow && sessionId ? (
          <PaymentFlow
            sessionId={sessionId}
            cart={payFlow.cart}
            options={payFlow.options}
            initialOrder={payFlow.pending}
            initialUncertain={payFlow.uncertain}
            address={addresses.find((address) => address.id === addressId)?.label}
            onAttempt={() => recordPayment({ ...payFlow, uncertain: true })}
            onPending={(order) => recordPayment({ ...payFlow, pending: order, uncertain: !order.paasId })}
            onTerminal={() => {
              setPendingPayment(null);
              setLatestCart(null);
            }}
            onPlaced={(order) => orderPlaced(payFlow.cart, order)}
            onFailedText={setNotice}
            onClose={() => setPayFlow(null)}
          />
        ) : null}
      </div>
    </MotionConfig>
  );
}
