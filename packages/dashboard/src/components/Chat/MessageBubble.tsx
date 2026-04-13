import { useState } from 'react';
import type { ChatMessage, ToolCallInfo } from './types';
import { ProcessAuditTrail } from './ProcessAuditTrail';

function ToolCallCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = tool.status === 'completed' ? '\u2705' : tool.status === 'error' ? '\u274C' : '\u23F3';

  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-light)',
        borderRadius: 8,
        padding: '8px 12px',
        marginTop: 8,
        cursor: 'pointer',
        fontSize: 13,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{tool.tool_emoji || '\uD83D\uDD27'}</span>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
          {tool.tool_name}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>{statusIcon}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
          {tool.args_preview && (
            <div style={{ marginBottom: 4 }}>
              <strong>Args:</strong> {tool.args_preview}
            </div>
          )}
          {tool.result_preview && (
            <div>
              <strong>Result:</strong> {tool.result_preview}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderMarkdown(text: string): string {
  // Simple markdown: bold, italic, code blocks, inline code, lists
  let html = text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:var(--bg-secondary);padding:12px;border-radius:8px;overflow-x:auto;font-size:13px;font-family:var(--font-mono);margin:8px 0"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;font-size:13px;font-family:var(--font-mono)">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>')
    // Line breaks
    .replace(/\n/g, '<br/>');
  return html;
}

export function MessageBubble({ message, sessionCostUsd = 0 }: { message: ChatMessage; sessionCostUsd?: number }) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
        maxWidth: '100%',
      }}
    >
      {/* Agent name label */}
      {!isUser && message.agent_name && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
            paddingLeft: 4,
          }}
        >
          <AgentAvatar name={message.agent_name} size={22} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {message.agent_name}
          </span>
        </div>
      )}

      {/* Message bubble */}
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? 'var(--accent-primary)' : 'var(--bg-card)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          border: isUser ? 'none' : '1px solid var(--border-light)',
          fontSize: 14,
          lineHeight: 1.6,
          wordBreak: 'break-word',
        }}
        title={message.timestamp ? new Date(message.timestamp).toLocaleString() : undefined}
      >
        {isUser ? (
          <span>{message.content}</span>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
        )}

        {/* Streaming cursor */}
        {message.isStreaming && (
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 16,
              background: 'var(--text-primary)',
              marginLeft: 2,
              animation: 'blink 1s step-end infinite',
              verticalAlign: 'text-bottom',
            }}
          />
        )}
      </div>

      {/* Tool calls */}
      {message.tool_calls && message.tool_calls.length > 0 && (
        <div style={{ maxWidth: '80%', width: '100%' }}>
          {message.tool_calls.map((tool, i) => (
            <ToolCallCard key={i} tool={tool} />
          ))}
        </div>
      )}

      {/* Process audit trail (agent messages only) */}
      {!isUser && message.processData && (
        <ProcessAuditTrail data={message.processData} sessionCostUsd={sessionCostUsd} />
      )}
    </div>
  );
}

export function AgentAvatar({ name: rawName, size = 32 }: { name: string; size?: number }) {
  // Deterministic color from name hash
  const name = rawName || '?';
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colors = ['#4b6fff', '#ff5eab', '#22c55e', '#eab308', '#ef4444', '#818cf8', '#14b8a6'];
  const bg = colors[hash % colors.length];

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: size * 0.5,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
