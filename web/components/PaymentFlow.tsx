'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import * as api from '@/lib/api';
import type { Cart, OrderResult, PaymentOptions } from '@/lib/types';

type Stage =
  | { kind: 'choose' }
  | { kind: 'placing' }
  | { kind: 'pending'; order: OrderResult; qr: boolean }
  | { kind: 'error'; message: string };

function failureText(status: string): string {
  switch (status) {
    case 'failed':
      return 'The payment failed. Check the payment and any refund status in Swiggy before retrying.';
    case 'refund-initiated':
      return 'The debit was reversed and a refund is underway. The order was not placed.';
    case 'cancelled':
      return 'The order was cancelled. Check Swiggy for any charge or refund details.';
    case 'cart_changed':
      return 'The cart changed during payment, so the order was not placed — review it and try again.';
    default:
      return 'The payment did not complete. Check the Swiggy app before retrying.';
  }
}

/**
 * The user's payment step at the confirm gate: pick COD / a UPI app / a UPI QR,
 * then (for UPI) wait while they approve in their own UPI app. Polling is
 * gentle — the server call already long-polls Swiggy's side — and ends with a
 * single idempotent confirm attempt if the window runs out.
 */
export default function PaymentFlow({
  sessionId,
  cart,
  options,
  onPlaced,
  onFailedText,
  onClose,
  initialOrder,
  initialUncertain,
  address,
  onPending,
  onAttempt,
  onTerminal,
}: {
  sessionId: string;
  cart: Cart;
  options: PaymentOptions;
  onPlaced: (order: OrderResult) => void;
  onFailedText: (message: string) => void;
  onClose: () => void;
  initialOrder?: OrderResult;
  initialUncertain?: boolean;
  address?: string;
  onPending: (order: OrderResult) => void;
  onAttempt: () => void;
  onTerminal: () => void;
}) {
  const [stage, setStage] = useState<Stage>(
    initialOrder
      ? { kind: 'pending', order: initialOrder, qr: false }
      : initialUncertain
        ? {
            kind: 'error',
            message:
              'The previous checkout result needs checking. Check your orders in Swiggy before starting another order.',
          }
        : { kind: 'choose' },
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // On a phone you can't scan a QR you're displaying — the UPI app buttons are
  // the mobile path, so hide the QR option there (unless it's the only UPI way).
  const [touchDevice, setTouchDevice] = useState(false);
  useEffect(() => setTouchDevice(window.matchMedia('(pointer: coarse)').matches), []);
  const stopRef = useRef(false);
  const pollGeneration = useRef(0);
  const payingRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stopRef.current = false;
    return () => {
      stopRef.current = true;
      pollGeneration.current++;
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (initialOrder) void poll(initialOrder);
    // A restored payment is checked, never submitted a second time.
  }, []);

  const pay = async (payment?: api.PaymentChoice) => {
    if (payingRef.current) return;
    payingRef.current = true;
    try {
      onAttempt();
    } catch {
      setStage({
        kind: 'error',
        message:
          'Your browser could not save the checkout state. Enable site storage before ordering. No order was submitted.',
      });
      return;
    }
    setStage({ kind: 'placing' });
    let res: Awaited<ReturnType<typeof api.placeOrder>>;
    try {
      res = await api.placeOrder(sessionId, cart.cartId, payment);
    } catch {
      setStage({
        kind: 'error',
        message: 'We could not confirm the checkout result. Check your Swiggy orders before trying again.',
      });
      return;
    }
    if (!res.placed || !res.order) {
      const message = res.error ?? res.reason ?? 'Could not place the order.';
      onFailedText(message);
      onClose();
      return;
    }
    const order = res.order;
    if (!order.pendingPayment) {
      onPlaced(order); // COD (or instantly-confirmed) — done.
      return;
    }
    try {
      onPending(order);
    } catch {
      /* the pre-checkout uncertainty marker remains saved */
    }
    if (!order.paasId) {
      setStage({
        kind: 'error',
        message:
          'This order is awaiting payment, but Swiggy did not return a tracking reference. Check the order in Swiggy before retrying.',
      });
      return;
    }
    const qr = payment?.qr === true;
    if (qr && order.upiIntentUrl) {
      try {
        setQrDataUrl(await QRCode.toDataURL(order.upiIntentUrl, { margin: 1, width: 220 }));
      } catch {
        /* QR render failed — the status poll still works; show text fallback */
      }
    }
    setStage({ kind: 'pending', order, qr });
    void poll(order);
  };

  const poll = async (order: OrderResult) => {
    if (!order.paasId) {
      setStage({
        kind: 'error',
        message:
          'Swiggy did not return a payment tracking reference. Check this order in Swiggy before retrying.',
      });
      return;
    }
    const generation = ++pollGeneration.current;
    const started = Date.now();
    const interval = Math.max(order.pollingIntervalInMs ?? 5000, 4000);
    const maxMs = Math.min(order.maxTimeToPollForInMs ?? 300000, 300000);
    while (!stopRef.current && generation === pollGeneration.current && Date.now() - started < maxMs) {
      try {
        const st = await api.paymentStatus(sessionId, order.paasId ?? '', order.orderId);
        if (stopRef.current || generation !== pollGeneration.current) return;
        if (st.confirmed) {
          onPlaced({ ...order, status: st.orderStatus ?? 'CONFIRMED', pendingPayment: false });
          return;
        }
        if (st.terminal && !['paid', 'success'].includes(st.status)) {
          onTerminal();
          setStage({ kind: 'error', message: failureText(st.status) });
          return;
        }
      } catch {
        /* transient — keep polling until the window closes */
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    if (stopRef.current || generation !== pollGeneration.current) return;
    // Window exhausted with payment still pending — one idempotent confirm try.
    try {
      const st = await api.paymentConfirm(sessionId, order.orderId, order.paasId ?? '');
      if (stopRef.current || generation !== pollGeneration.current) return;
      if (st.confirmed) {
        onPlaced({ ...order, status: 'CONFIRMED', pendingPayment: false });
        return;
      }
    } catch {
      /* fall through to the timeout message */
    }
    setStage({
      kind: 'error',
      message: 'Payment is taking longer than expected — check the Swiggy app before retrying.',
    });
  };

  return (
    <div
      className="paysheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Review your order and payment"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && stage.kind !== 'placing') {
          event.preventDefault();
          onClose();
        }
        if (event.key === 'Tab') {
          const elements = sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
          if (!elements?.length) {
            event.preventDefault();
            return;
          }
          const first = elements[0],
            last = elements[elements.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === sheetRef.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="paysheet" ref={sheetRef} tabIndex={-1}>
        {stage.kind === 'choose' ? (
          <>
            <div className="eyebrow">ONE LAST LOOK</div>
            <div className="paysheet-title">Your order, ready to go.</div>
            {address ? (
              <div className="payment-address">
                <strong>Deliver to</strong>
                <p>{address}</p>
              </div>
            ) : null}
            <div className="payment-review">
              {cart.lines.map((line) => (
                <div key={line.id}>
                  <span>
                    {line.qty} × {line.name.replace(/^\[DEMO\]\s*/, '')}
                  </span>
                  <strong>₹{line.lineTotal}</strong>
                </div>
              ))}
              {cart.bill?.length ? (
                cart.bill.map((line) => (
                  <div key={line.label}>
                    <span>{line.label}</span>
                    <strong>₹{line.amount}</strong>
                  </div>
                ))
              ) : (
                <div>
                  <span>Delivery & fees</span>
                  <strong>₹{cart.fees}</strong>
                </div>
              )}
              <div className="payment-total">
                <span>Total to pay</span>
                <strong>₹{cart.total}</strong>
              </div>
            </div>
            <div className="paysheet-sub">Choose a payment method to place this order.</div>
            <div className="paysheet-options">
              {options.codAvailable ? (
                <button className="paybtn" onClick={() => void pay({ method: 'cod' })}>
                  Place order · ₹{cart.total} cash on delivery
                </button>
              ) : null}
              {options.upiApps.map((a) => (
                <button
                  key={a.id}
                  className="paybtn"
                  onClick={() => void pay({ method: 'upi', intentApp: a.id })}
                >
                  Pay ₹{cart.total} with {a.label}
                </button>
              ))}
              {options.qrAvailable && !(touchDevice && options.upiApps.length > 0) ? (
                <button className="paybtn" onClick={() => void pay({ method: 'upi', qr: true })}>
                  Pay ₹{cart.total} with a UPI QR
                </button>
              ) : null}
            </div>
            <button className="paysheet-cancel" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : null}

        {stage.kind === 'placing' ? <div className="paysheet-title">Placing your order…</div> : null}

        {stage.kind === 'pending' ? (
          <>
            <div className="paysheet-title">Waiting for your payment</div>
            {qrDataUrl ? (
              // Locally generated data URI of Swiggy's UPI link — nothing external.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="paysheet-qr" src={qrDataUrl} alt="UPI payment QR code" />
            ) : stage.order.upiIntentUrl ? (
              <a className="paybtn paybtn-primary" href={stage.order.upiIntentUrl}>
                Open your UPI app to pay ₹{cart.total}
              </a>
            ) : stage.order.bridgeUrl ? (
              // The QR flow returns Swiggy's own hosted payment page — open it beside us.
              <a
                className="paybtn paybtn-primary"
                href={stage.order.bridgeUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Swiggy’s payment page · ₹{cart.total}
              </a>
            ) : (
              <div className="paysheet-sub">
                Swiggy didn’t send a payment link. Open the Swiggy app to check this order before trying
                another payment.
              </div>
            )}
            <div className="paysheet-sub">
              Approve the payment in your UPI app — this updates by itself once Swiggy confirms.
            </div>
            <button className="paysheet-cancel" onClick={onClose}>
              Close — I’ll finish this in the Swiggy app
            </button>
          </>
        ) : null}

        {stage.kind === 'error' ? (
          <>
            <div className="paysheet-title">Check your order</div>
            <div className="paysheet-sub">{stage.message}</div>
            <button className="paysheet-cancel" onClick={onClose}>
              Close
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
