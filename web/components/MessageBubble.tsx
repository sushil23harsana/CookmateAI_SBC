'use client';

import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import type { ChatItem } from '@/lib/types';

export default function MessageBubble({ item }: { item: ChatItem }) {
  const isUser = item.role === 'user';
  const text = item.text ?? '';

  return (
    <motion.div
      className={`row ${item.role}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      {isUser ? (
        <div className="bubble user">{text}</div>
      ) : (
        // Always render markdown (even mid-stream) so asterisks never show raw.
        <div className={`bubble assistant md${item.streaming ? ' streaming' : ''}`}>
          <ReactMarkdown>{text}</ReactMarkdown>
          {item.streaming ? <span className="caret" aria-hidden="true" /> : null}
        </div>
      )}
    </motion.div>
  );
}
