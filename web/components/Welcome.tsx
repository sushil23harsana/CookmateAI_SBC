'use client';

import { motion } from 'framer-motion';

const SUGGESTIONS = [
  { emoji: '🍝', text: 'Healthy pasta for 2' },
  { emoji: '💸', text: '₹400 dinner for two' },
  { emoji: '🧀', text: 'Quick paneer butter masala' },
  { emoji: '🧂', text: 'Restock my kitchen basics' },
];

export default function Welcome({ onPick }: { onPick: (t: string) => void }) {
  return (
    <motion.div
      className="welcome"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="kicker">Your kitchen co-pilot</div>
      <h1>
        What are we <em>cooking</em> today?
      </h1>
      <p>Name a dish or set a budget — I’ll turn it into a ready-to-order Instamart basket.</p>
      <div className="chips">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s.text}
            className="suggest"
            onClick={() => onPick(s.text)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 + i * 0.07, type: 'spring', stiffness: 300, damping: 24 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            <span className="emoji">{s.emoji}</span>
            {s.text}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
