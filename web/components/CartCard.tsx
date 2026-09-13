'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { Cart } from '@/lib/types';

export const cleanName = (n: string) => n.replace(/^\[DEMO\]\s*/, '');

export function emojiFor(name: string): string {
  const n = name.toLowerCase();
  const map: [string, string][] = [
    ['pasta', '🍝'],
    ['fusilli', '🍝'],
    ['sauce', '🥫'],
    ['passata', '🥫'],
    ['olive', '🫒'],
    ['oil', '🫒'],
    ['garlic', '🧄'],
    ['onion', '🧅'],
    ['tomato', '🍅'],
    ['capsicum', '🫑'],
    ['pepper', '🫑'],
    ['broccoli', '🥦'],
    ['mushroom', '🍄'],
    ['parmesan', '🧀'],
    ['cheese', '🧀'],
    ['mozz', '🧀'],
    ['basil', '🌿'],
    ['chilli', '🌶️'],
    ['salt', '🧂'],
    ['chicken', '🍗'],
    ['butter', '🧈'],
    ['cream', '🥛'],
    ['milk', '🥛'],
  ];
  for (const [k, e] of map) if (n.includes(k)) return e;
  return '🛒';
}

export default function CartCard({
  cart,
  ordered,
  onPlace,
  active = true,
  busy = false,
  demo = false,
}: {
  cart: Cart;
  ordered: boolean;
  onPlace: () => Promise<void>;
  active?: boolean;
  busy?: boolean;
  demo?: boolean;
}) {
  const [placing, setPlacing] = useState(false);
  const total = cart.total;
  const count = cart.lines.reduce((s, l) => s + l.qty, 0);

  const place = async () => {
    if (placing || ordered || busy || !active) return;
    setPlacing(true);
    try {
      await onPlace();
    } finally {
      setPlacing(false);
    }
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <div className="card-head">
        <div className="card-title">Your basket</div>
        <div className="chip">
          {count} item{count === 1 ? '' : 's'}
        </div>
      </div>

      <div className="lines">
        {cart.lines.map((l, i) => (
          <motion.div
            key={l.id}
            className="line"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 320, damping: 26 }}
          >
            <div className="lc">{emojiFor(l.name)}</div>
            <div className="ln">
              {cleanName(l.name)}
              {l.qty > 1 ? <span className="lqty">×{l.qty}</span> : null}
              <small className="product-meta">
                {[l.brand, l.packSize].filter(Boolean).join(' · ')}
                {l.packSize ? ' · ' : ''}₹{l.price} each
              </small>
            </div>
            <div className="lp">₹{l.lineTotal}</div>
          </motion.div>
        ))}
      </div>

      <div className="totals">
        {cart.bill?.length ? (
          // Swiggy's own bill lines (delivery, GST, discounts) — the real charges.
          cart.bill.map((b) => (
            <div className="trow" key={b.label}>
              <span>{b.label}</span>
              <span>₹{b.amount}</span>
            </div>
          ))
        ) : (
          <>
            <div className="trow">
              <span>Items</span>
              <span>₹{cart.itemsTotal}</span>
            </div>
            <div className="trow">
              <span>Delivery</span>
              <span>₹{cart.fees}</span>
            </div>
          </>
        )}
        <div className="trow grand">
          <span>To pay</span>
          <span className="rupee">₹{total}</span>
        </div>
      </div>

      {cart.belowMinOrderValue ? (
        <div style={{ padding: '6px 18px 0' }}>
          <span className="chip warn">
            Add ₹{cart.minOrderValue - cart.itemsTotal} more to reach the minimum
          </span>
        </div>
      ) : null}

      <div className="card-foot">
        <button
          className={`btn ${ordered ? 'placed' : ''}`}
          onClick={place}
          disabled={placing || ordered || busy || !active || cart.belowMinOrderValue}
        >
          {ordered ? (
            <>✓ Order placed</>
          ) : !active ? (
            <>Earlier basket · review the latest</>
          ) : placing ? (
            <>
              <span className="spinner" /> Loading payment options…
            </>
          ) : (
            <>Review & pay · ₹{cart.total}</>
          )}
        </button>
        <div className="note">
          {demo
            ? 'Demo catalogue · no real order'
            : 'Swiggy Instamart · choose a payment method before ordering'}
        </div>
      </div>
    </motion.div>
  );
}
