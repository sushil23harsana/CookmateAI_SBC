'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Cart } from '@/lib/types';
import { cleanName, emojiFor } from './CartCard';

/**
 * Collapsible cart pinned above the composer: the compact bar is always
 * visible while a cart is active; tapping it expands the full basket for
 * review, with +/- steppers that re-review the cart server-side so the
 * snapshot stays authoritative. Place order works from either state.
 */
export default function CartDock({
  cart,
  busy,
  onPlace,
  onChangeQty,
}: {
  cart: Cart;
  busy: boolean;
  onPlace: (cart: Cart) => Promise<void>;
  onChangeQty: (skuId: string, qty: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const count = cart.lines.reduce((s, l) => s + l.qty, 0);
  const locked = busy || placing || updating;

  const place = async () => {
    if (placing) return;
    setPlacing(true);
    try {
      await onPlace(cart);
    } finally {
      setPlacing(false);
    }
  };

  const step = async (skuId: string, qty: number) => {
    if (locked) return;
    setUpdating(true);
    try {
      await onChangeQty(skuId, qty);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="cartdock">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className="cartdock-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="lines">
              {cart.lines.map((l) => (
                <div key={l.id} className="line">
                  <div className="lc">{emojiFor(l.name)}</div>
                  <div className="ln">{cleanName(l.name)}</div>
                  <div className="qty">
                    <button
                      className="qbtn"
                      aria-label={`One less ${cleanName(l.name)}`}
                      disabled={locked || (cart.lines.length === 1 && l.qty === 1)}
                      onClick={() => void step(l.id, l.qty - 1)}
                    >
                      −
                    </button>
                    <span className="qval">{l.qty}</span>
                    <button
                      className="qbtn"
                      aria-label={`One more ${cleanName(l.name)}`}
                      disabled={locked}
                      onClick={() => void step(l.id, l.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <div className="lp">₹{l.lineTotal}</div>
                </div>
              ))}
            </div>
            <div className="totals">
              {cart.bill?.length ? (
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
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div
        className="cartbar"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={open ? 'Collapse the cart' : 'Expand the cart to review items'}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <div className="cartbar-info">
          <svg className="chev" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 10 8 5.5 12.5 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          🧺 {count} item{count === 1 ? '' : 's'} · <strong>₹{updating ? '…' : cart.total}</strong>
        </div>
        <button
          className="cartbar-btn"
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            void place();
          }}
        >
          {placing ? 'Placing…' : 'Place order'}
        </button>
      </div>
    </div>
  );
}
