'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Cart } from '@/lib/types';

const cleanName = (n: string) => n.replace(/^\[DEMO\]\s*/, '');

function emojiFor(name: string): string {
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

function useCountUp(target: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 650;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

export default function CartCard({
  cart,
  ordered,
  onPlace,
}: {
  cart: Cart;
  ordered: boolean;
  onPlace: () => Promise<void>;
}) {
  const [placing, setPlacing] = useState(false);
  const total = useCountUp(cart.total);
  const count = cart.lines.reduce((s, l) => s + l.qty, 0);

  const place = async () => {
    if (placing || ordered) return;
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
            </div>
            <div className="lp">₹{l.lineTotal}</div>
          </motion.div>
        ))}
      </div>

      <div className="totals">
        <div className="trow">
          <span>Items</span>
          <span>₹{cart.itemsTotal}</span>
        </div>
        <div className="trow">
          <span>Delivery</span>
          <span>₹{cart.fees}</span>
        </div>
        <div className="trow grand">
          <span>Total</span>
          <span className="rupee">₹{total}</span>
        </div>
      </div>

      {cart.belowMinOrderValue ? (
        <div style={{ padding: '6px 18px 0' }}>
          <span className="chip warn">Add ₹{cart.minOrderValue - cart.itemsTotal} more to reach the minimum</span>
        </div>
      ) : null}

      <div className="card-foot">
        <button className={`btn ${ordered ? 'placed' : ''}`} onClick={place} disabled={placing || ordered}>
          {ordered ? (
            <>✓ Order placed</>
          ) : placing ? (
            <>
              <span className="spinner" /> Placing…
            </>
          ) : (
            <>Place order · ₹{cart.total}</>
          )}
        </button>
        <div className="note">Sample catalogue · nothing is bought until you tap Place order</div>
      </div>
    </motion.div>
  );
}
