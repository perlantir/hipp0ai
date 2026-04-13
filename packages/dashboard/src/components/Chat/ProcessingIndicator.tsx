import type { ProcessingStatus, ActiveToolCall, Hipp0Activity } from './types';

interface ProcessingIndicatorProps {
  status: ProcessingStatus;
  activeToolCalls: ActiveToolCall[];
  hipp0Activity: Hipp0Activity | null;
}

const MAX_VISIBLE_TOOLS = 3;

function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusLine({ status }: { status: ProcessingStatus }) {
  if (status === 'idle') return null;

  const config: Record<Exclude<ProcessingStatus, 'idle'>, { icon: string; text: string; animation: string }> = {
    compiling: {
      icon: '\uD83E\uDDE0',
      text: 'Fetching context from shared memory...',
      animation: 'spin 1.5s linear infinite',
    },
    thinking: {
      icon: '\uD83E\uDDE0',
      text: 'Thinking...',
      animation: 'pulse 1.5s ease-in-out infinite',
    },
    capturing: {
      icon: '\uD83D\uDCBE',
      text: 'Saving to memory...',
      animation: 'pulse 1.5s ease-in-out infinite',
    },
  };

  const { icon, text, animation } = config[status];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span style={{ display: 'inline-block', animation, fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
        {text}
      </span>
    </div>
  );
}

function ToolCallLine({ tool }: { tool: ActiveToolCall }) {
  const emoji = tool.tool_emoji || '\uD83D\uDD27';
  const isDone = tool.status !== 'started';
  const duration = formatDuration(tool.started_at, tool.completed_at);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        opacity: isDone ? 0.6 : 1,
        transition: 'opacity 0.3s',
      }}
    >
      <span style={{ fontSize: 14 }}>{emoji}</span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
        {tool.tool_name}
      </span>
      {tool.args_preview && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tool.args_preview}
        </span>
      )}
      {isDone && (
        <span style={{ fontSize: 11, color: tool.status === 'error' ? 'var(--accent-danger)' : 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {tool.status === 'error' ? 'failed' : duration}
        </span>
      )}
      {!isDone && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginLeft: 'auto',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          {duration}
        </span>
      )}
    </div>
  );
}

export function ProcessingIndicator({ status, activeToolCalls, hipp0Activity }: ProcessingIndicatorProps) {
  const isVisible = status !== 'idle' || activeToolCalls.length > 0 || hipp0Activity !== null;
  if (!isVisible) return null;

  // Show only the most recent MAX_VISIBLE_TOOLS tool calls
  const visibleTools = activeToolCalls.slice(-MAX_VISIBLE_TOOLS);
  const collapsedCount = activeToolCalls.length - visibleTools.length;

  return (
    <div style={{ padding: '4px 16px 8px', borderTop: '1px solid var(--border-light)' }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <StatusLine status={status} />

      {collapsedCount > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 0' }}>
          +{collapsedCount} earlier tool call{collapsedCount > 1 ? 's' : ''}
        </div>
      )}

      {visibleTools.map((tool, i) => (
        <ToolCallLine key={`${tool.tool_name}-${tool.started_at}-${i}`} tool={tool} />
      ))}

      {hipp0Activity && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
            fontSize: 12,
            color: 'var(--text-tertiary)',
          }}
        >
          <span>{'\uD83E\uDDE0'}</span>
          <span>{hipp0Activity.message}</span>
        </div>
      )}
    </div>
  );
}
