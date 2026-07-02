'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { Phase } from '@/lib/types';

const COPY: Record<Phase, [string, string]> = {
  recipe: ['Dreaming up your recipe', 'simmering some ideas'],
  pantry: ['Peeking into your pantry', 'what do you already have?'],
  searching: ['Scanning the aisles', 'finding the freshest picks'],
  budget: ['Counting every rupee', 'making it all fit'],
  cart: ['Packing your basket', 'almost there'],
  ordering: ['Sending it to the kitchen', 'placing your order'],
  tracking: ['Checking on your order', 'one moment'],
  thinking: ['Thinking it through', ''],
};

export default function WorkingState({ phase }: { phase: Phase }) {
  const [title, sub] = COPY[phase] ?? COPY.thinking;
  return (
    <motion.div
      className="working"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
    >
      <div className="icon">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5, rotate: 10 }}
            transition={{ duration: 0.26 }}
            style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}
          >
            <PhaseIcon phase={phase} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${phase}-text`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <div className="label">
              {title}
              <Ellipsis />
            </div>
            {sub ? <div className="sub">{sub}</div> : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Ellipsis() {
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 3, verticalAlign: 'middle' }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{ width: 3, height: 3, borderRadius: 9, background: 'currentColor', opacity: 0.5 }}
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </span>
  );
}

function PhaseIcon({ phase }: { phase: Phase }) {
  const s = { width: 26, height: 26 };
  switch (phase) {
    case 'recipe':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          {[11, 14, 17].map((x, i) => (
            <path
              key={x}
              className={`steam${i === 1 ? ' s2' : i === 2 ? ' s3' : ''}`}
              d={`M${x} 11 c-1.4 -2 1.4 -3 0 -5.4`}
              fill="none"
              stroke="#e8821e"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ))}
          <path d="M5 13 h18 v3.6 a6 6 0 0 1 -6 6 h-6 a6 6 0 0 1 -6 -6 z" fill="#e8821e" />
          <rect x="3.6" y="11.6" width="20.8" height="2.6" rx="1.3" fill="#bf6210" />
          <rect x="2" y="16" width="3.4" height="2.2" rx="1.1" fill="#bf6210" />
          <rect x="22.6" y="16" width="3.4" height="2.2" rx="1.1" fill="#bf6210" />
        </svg>
      );
    case 'pantry':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          <g className="bob">
            <rect x="8" y="9" width="12" height="14" rx="3" fill="#6da257" />
            <rect x="6.6" y="6.6" width="14.8" height="3.2" rx="1.6" fill="#4f7b45" />
            <circle cx="14" cy="16" r="2.5" fill="#fffcf6" opacity="0.85" />
          </g>
          <path
            className="simmer"
            d="M22 7 l.7 1.5 1.5 .7 -1.5 .7 -.7 1.5 -.7 -1.5 -1.5 -.7 1.5 -.7z"
            fill="#e3a93a"
          />
        </svg>
      );
    case 'searching':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          {[10, 15, 20].map((y) => (
            <line key={y} x1="6" y1={y} x2="22" y2={y} stroke="#ece0ca" strokeWidth="1.6" strokeLinecap="round" />
          ))}
          <g className="sweep">
            <circle cx="13" cy="13" r="5" fill="rgba(255,255,255,0.7)" stroke="#de4d2a" strokeWidth="1.8" />
            <line x1="16.6" y1="16.6" x2="20.5" y2="20.5" stroke="#de4d2a" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>
      );
    case 'budget':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          <ellipse cx="14" cy="22" rx="7" ry="2" fill="#e3a93a" opacity="0.5" />
          <g className="spin" style={{ transformOrigin: '14px 13px' }}>
            <circle cx="14" cy="13" r="8" fill="#e3a93a" stroke="#bf6210" strokeWidth="1.4" />
            <text x="14" y="17.4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#7a4708">
              ₹
            </text>
          </g>
        </svg>
      );
    case 'cart':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          <circle className="drop" cx="11" cy="9" r="2.5" fill="#de4d2a" />
          <circle className="drop d2" cx="16.5" cy="9" r="2.5" fill="#6da257" />
          <path d="M5 12.5 h18 l-1.8 8.6 a2.2 2.2 0 0 1 -2.1 1.7 h-8.2 a2.2 2.2 0 0 1 -2.1 -1.7 z" fill="#e8821e" />
          <rect x="3.6" y="11.2" width="20.8" height="2.4" rx="1.2" fill="#bf6210" />
        </svg>
      );
    case 'ordering':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          <path d="M8 11 h12 l1 11 a2.2 2.2 0 0 1 -2.2 2 h-9.6 a2.2 2.2 0 0 1 -2.2 -2 z" fill="#6da257" />
          <path d="M10.2 11 a3.8 3.8 0 0 1 7.6 0" fill="none" stroke="#3c6438" strokeWidth="1.7" />
          <path
            className="draw"
            d="M10.6 17 l2.2 2.4 4.6 -5.2"
            fill="none"
            stroke="#fffdf6"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'tracking':
      return (
        <svg viewBox="0 0 28 28" {...s}>
          <g className="bob">
            <path d="M14 5 c4.2 0 6.6 3 6.6 6.4 c0 4.4 -6.6 11 -6.6 11 s-6.6 -6.6 -6.6 -11 c0 -3.4 2.4 -6.4 6.6 -6.4z" fill="#de4d2a" />
            <circle cx="14" cy="11.4" r="2.6" fill="#fff" />
          </g>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 28 28" {...s}>
          {[9, 14, 19].map((x, i) => (
            <circle
              key={x}
              className={`simmer${i === 1 ? ' s2' : i === 2 ? ' s3' : ''}`}
              cx={x}
              cy="15"
              r="2.5"
              fill="#e8821e"
            />
          ))}
        </svg>
      );
  }
}
