import { useState, useRef, useCallback, type KeyboardEvent } from 'react';

const MAX_QUEUE_SIZE = 10;

interface ChatInputProps {
  onSend: (content: string) => void;
  onQueue: (content: string) => boolean; // returns false if queue full
  isProcessing: boolean;
  isConnected: boolean;
  queueCount: number;
  agentName: string;
}

export function ChatInput({ onSend, onQueue, isProcessing, isConnected, queueCount, agentName }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !isConnected) return;

    if (isProcessing) {
      if (queueCount >= MAX_QUEUE_SIZE) return; // queue full
      onQueue(trimmed);
    } else {
      onSend(trimmed);
    }
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isProcessing, isConnected, queueCount, onSend, onQueue]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, []);

  const cantSend = !isConnected || !text.trim();

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-light)',
        padding: '12px 16px',
        background: 'var(--bg-card)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={
          !isConnected
            ? 'Reconnecting...'
            : isProcessing
              ? `${agentName} is working... type to queue`
              : `Message ${agentName}...`
        }
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          border: '1px solid var(--border-light)',
          borderRadius: 12,
          padding: '10px 14px',
          fontSize: 14,
          fontFamily: 'var(--font-body)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          outline: 'none',
          lineHeight: 1.5,
          maxHeight: 120,
          overflow: 'auto',
        }}
      />
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={handleSend}
          disabled={cantSend}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            background: cantSend ? 'var(--bg-secondary)' : 'var(--accent-primary)',
            color: cantSend ? 'var(--text-tertiary)' : '#fff',
            cursor: cantSend ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            transition: 'background 0.15s',
          }}
          title={isProcessing ? 'Queue message' : 'Send message'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
        {queueCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              background: 'var(--accent-warning, #eab308)',
              color: '#000',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
            }}
          >
            {queueCount}
          </span>
        )}
      </div>
    </div>
  );
}
