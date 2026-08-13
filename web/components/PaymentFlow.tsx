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
      return 'The payment was declined — nothing was charged, or a refund is on its way.';
    case 'refund-initiated':
      return 'The debit was reversed and a refund is underway. The order was not placed.';
    case 'cancelled':
      return 'The order was cancelled. Any charge will be refunded.';
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
}: {
  sessionId: string;
  cart: Cart;
  options: PaymentOptions;
  onPlaced: (order: OrderResult) => void;
  onFailedText: (message: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const stopRef = useRef(false);
  useEffect(
    () => () => {
      stopRef.current = true;
    },
    [],
  );

  const pay = async (payment?: api.PaymentChoice) => {
    setStage({ kind: 'placing' });
    let res: Awaited<ReturnType<typeof api.placeOrder>>;
    try {
      res = await api.placeOrder(sessionId, cart.cartId, payment);
    } catch {
      setStage({ kind: 'error', message: 'Could not reach the kitchen — try again in a moment.' });
      return;
    }
    if (!res.placed || !res.order) {
      const message = res.error ?? res.reason ?? 'Could not place the order.';
      onFailedText(message);
      onClose();
      return;
    }
    const order = res.order;
    if (!order.pendingPayment || !order.paasId) {
      onPlaced(order); // COD (or instantly-confirmed) — done.
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
    const started = Date.now();
    const interval = Math.max(order.pollingIntervalInMs ?? 5000, 4000);
    const maxMs = Math.min(order.maxTimeToPollForInMs ?? 300000, 300000);
    while (!stopRef.current && Date.now() - started < maxMs) {
      try {
        const st = await api.paymentStatus(sessionId, order.paasId ?? '', order.orderId);
        if (st.confirmed || st.status === 'success' || st.status === 'paid') {
          onPlaced({ ...order, status: st.orderStatus ?? 'CONFIRMED', pendingPayment: false });
          return;
        }
        if (st.terminal) {
          setStage({ kind: 'error', message: failureText(st.status) });
          return;
        }
      } catch {
        /* transient — keep polling until the window closes */
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    if (stopRef.current) return;
    // Window exhausted with payment still pending — one idempotent confirm try.
    try {
      const st = await api.paymentConfirm(sessionId, order.orderId, order.paasId ?? '');
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
    <div className="paysheet-backdrop" role="dialog" aria-modal="true" aria-label="Choose how to pay">
      <div className="paysheet">
        {stage.kind === 'choose' ? (
          <>
            <div className="paysheet-title">Pay ₹{cart.total}</div>
            <div className="paysheet-sub">Cash on delivery, or pay now with UPI.</div>
            <div className="paysheet-options">
              <button className="paybtn" onClick={() => void pay()}>
                💵 Cash on Delivery
              </button>
              {options.upiApps.map((a) => (
                <button
                  key={a.id}
                  className="paybtn"
                  onClick={() => void pay({ method: 'upi', intentApp: a.id })}
                >
                  📲 {a.label}
                </button>
              ))}
              {options.qrAvailable ? (
                <button className="paybtn" onClick={() => void pay({ method: 'upi', qr: true })}>
                  🔳 Scan a UPI QR
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
            {stage.qr ? (
              qrDataUrl ? (
                // Locally generated data URI of Swiggy's UPI link — nothing external.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="paysheet-qr" src={qrDataUrl} alt="UPI payment QR code" />
              ) : (
                <div className="paysheet-sub">Open your UPI app and pay ₹{cart.total}.</div>
              )
            ) : stage.order.upiIntentUrl ? (
              <a className="paybtn paybtn-primary" href={stage.order.upiIntentUrl}>
                Open your UPI app to pay ₹{cart.total}
              </a>
            ) : null}
            <div className="paysheet-sub">
              Approve the payment in your UPI app — this updates by itself once Swiggy confirms.
            </div>
          </>
        ) : null}

        {stage.kind === 'error' ? (
          <>
            <div className="paysheet-title">Payment didn’t go through</div>
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
