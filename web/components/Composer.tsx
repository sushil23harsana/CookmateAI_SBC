'use client';

import { useRef, useState } from 'react';

export default function Composer({ onSend, busy }: { onSend: (t: string) => void; busy: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="Tell me a dish or a budget…"
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="send" onClick={submit} disabled={busy || !text.trim()} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h13M12 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
