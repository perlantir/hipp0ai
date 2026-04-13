import { MessageSquare, Terminal } from 'lucide-react';

export function ChatPlaceholder() {
  const cliCommand =
    'cd /root/integration/hermes-agent && source ~/.hermes/venv/bin/activate && set -a && source /etc/team-hippo/secrets.env && set +a && python3 hermes_cli/repl.py --agent alice';

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '48px 16px',
        textAlign: 'center',
      }}
    >
      {/* Icon */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 72,
          height: 72,
          borderRadius: 18,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-light)',
          marginBottom: 20,
        }}
      >
        <MessageSquare size={36} style={{ color: 'var(--accent-primary, #063ff9)' }} />
      </div>

      {/* Title */}
      <h2
        style={{
          color: 'var(--text-primary)',
          fontSize: 24,
          fontWeight: 700,
          margin: '0 0 8px',
          fontFamily: 'var(--font-heading)',
        }}
      >
        Chat with your agents
      </h2>

      {/* Subtitle */}
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 15,
          margin: '0 0 32px',
        }}
      >
        Real-time chat with Alice and your team is coming soon.
      </p>

      {/* CLI card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-light)',
          borderRadius: 12,
          padding: 20,
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <Terminal size={16} style={{ color: 'var(--text-secondary)' }} />
          <span
            style={{
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Talk to Alice now via CLI
          </span>
        </div>

        <pre
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-light)',
            borderRadius: 8,
            padding: 14,
            margin: '0 0 12px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflowX: 'auto',
          }}
        >
          {cliCommand}
        </pre>

        <p
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 12,
            margin: 0,
          }}
        >
          Full browser-based chat with streaming, tool calls, and context injection is being built.
        </p>
      </div>
    </div>
  );
}
