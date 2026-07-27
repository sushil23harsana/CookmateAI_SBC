'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Cart } from '@/lib/types';
import { cleanName, emojiFor } from './CartCard';

/**
 * Collapsible cart pinned above the composer: the compact bar is always
 * visible while a cart is active; tapping it expands the full basket for
 * review. Place order works from either state.
 */
export default function CartDock({
  cart,
  busy,
  onPlace,
}: {
  cart: Cart;
  busy: boolean;
  onPlace: (cart: Cart) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const count = cart.lines.reduce((s, l) => s + l.qty, 0);

  const place = async () => {
    if (placing) return;
    setPlacing(true);
    try {
      await onPlace(cart);
    } finally {
      setPlacing(false);
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
                  <div className="ln">
                    {cleanName(l.name)}
                    {l.qty > 1 ? <span className="lqty">×{l.qty}</span> : null}
                  </div>
                  <div className="lp">₹{l.lineTotal}</div>
                </div>
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
          🧺 {count} item{count === 1 ? '' : 's'} · <strong>₹{cart.total}</strong>
        </div>
        <button
          className="cartbar-btn"
          disabled={busy || placing}
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
