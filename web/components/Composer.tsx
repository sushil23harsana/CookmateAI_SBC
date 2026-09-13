'use client';
export default function Composer({
  onSend,
  busy,
  locked,
  text,
  onChange,
  onConnect,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  locked: boolean;
  text: string;
  onChange: (text: string) => void;
  onConnect: () => void;
}) {
  const submit = () => {
    if (busy || !text.trim()) return;
    if (locked) {
      onConnect();
      return;
    }
    onSend(text.trim());
  };
  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          rows={1}
          value={text}
          aria-label="Your meal idea or grocery list"
          maxLength={2000}
          placeholder={locked ? 'Your meal or grocery list…' : 'A dish or a grocery list…'}
          onChange={(e) => {
            onChange(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="send"
          onClick={submit}
          disabled={busy || !text.trim()}
          aria-label={locked ? 'Connect Swiggy to continue' : 'Send message'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12h13M12 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <p className="composer-caption">
        {locked
          ? 'Connect Swiggy to start. Your draft stays here until you’re ready.'
          : 'Review product details and totals before ordering. AI can make mistakes.'}
      </p>
      <div className="composer-links">
        <a href="/help">Help</a>
        <span>·</span>
        <a href="/privacy">Your data</a>
      </div>
    </div>
  );
}
