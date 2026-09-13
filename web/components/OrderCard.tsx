'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { OrderResult } from '@/lib/types';

const STEPS = ['Confirmed', 'Packing', 'On the way', 'Delivered'];

function stepIndex(status: string): number {
  const s = status.toUpperCase();
  if (s.includes('CANCEL') || s.includes('FAIL') || s.includes('PENDING_PAYMENT')) return -1;
  if (s.includes('OUT_FOR_DELIVERY') || s.includes('WAY') || s.includes('TRANSIT')) return 2;
  if (s === 'DELIVERED' || s === 'ORDER_DELIVERED') return 3;
  if (s.includes('PACK')) return 1;
  return /CONFIRM|PLACED|ACCEPT/.test(s) ? 0 : -1;
}

export default function OrderCard({
  order,
  onTrack,
}: {
  order: OrderResult;
  onTrack: () => Promise<string>;
}) {
  const [status, setStatus] = useState(order.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idx = stepIndex(status);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await onTrack());
    } catch {
      setError('Could not refresh the status. Try again or check your order in Swiggy.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 24 }}
    >
      <div style={{ padding: '18px 18px 4px', textAlign: 'center' }}>
        <div className="success-badge" hidden={idx < 0}>
          <div className="burst">
            {Array.from({ length: 9 }).map((_, i) => {
              const a = (i / 9) * Math.PI * 2;
              const style = {
                '--bx': `${Math.cos(a) * 36}px`,
                '--by': `${Math.sin(a) * 36}px`,
                background: i % 2 ? 'var(--herb-2)' : 'var(--saffron)',
                animationDelay: '0.1s',
              } as CSSProperties;
              return <span key={i} style={style} />;
            })}
          </div>
          <svg viewBox="0 0 74 74" width="74" height="74">
            <circle cx="37" cy="37" r="33" fill="#e3efd9" stroke="#6da257" strokeWidth="2" />
            <path
              d="M24 38 l9 9 17 -20"
              fill="none"
              stroke="#4f7b45"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ strokeDasharray: 60, strokeDashoffset: 60, animation: 'draw 0.7s 0.15s forwards' }}
            />
          </svg>
        </div>
        <div className="card-title" style={{ fontSize: 22 }}>
          {idx >= 0 ? STEPS[idx] : status.replaceAll('_', ' ').toLowerCase()}
        </div>
        <div style={{ color: 'var(--ink-2)', fontSize: 14, marginTop: 4 }}>
          #{order.orderId}
          {order.etaMinutes != null ? <> · ~{order.etaMinutes} min away</> : null}
        </div>
      </div>

      <div className="timeline">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < idx ? 'done' : ''} ${i === idx ? 'active' : ''}`}>
            <div className="node" />
            <div className="slabel">{s}</div>
          </div>
        ))}
      </div>

      <div className="card-foot">
        {error ? <p role="status">{error}</p> : null}
        <button className="btn placed" onClick={refresh} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" /> Checking…
            </>
          ) : (
            <>Refresh status</>
          )}
        </button>
      </div>
    </motion.div>
  );
}
