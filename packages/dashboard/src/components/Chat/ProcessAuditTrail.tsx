import { useState } from 'react';
import type { MessageProcessData, ToolCallInfo, CompileAuditData, CaptureAuditData, StreamEndData } from './types';

interface ProcessAuditTrailProps {
  data: MessageProcessData;
  sessionCostUsd: number;
}

function scoreColor(score: number): string {
  if (score > 0.7) return '#22c55e';
  if (score > 0.3) return '#eab308';
  return '#9ca3af';
}

function costColor(cost: number): string {
  if (cost > 0.20) return '#ef4444';
  if (cost > 0.05) return '#eab308';
  return '#22c55e';
}

function Section({
  title,
  collapsed,
  expandedContent,
  onToggle,
}: {
  title: string;
  collapsed: string;
  expandedContent: React.ReactNode;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => { setOpen(!open); onToggle(); }}
        style={{
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 0',
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '\u25BC' : '\u25B6'}</span>
        <span>{collapsed}</span>
      </div>
      {open && (
        <div style={{
          padding: '6px 0 6px 18px',
          fontSize: 12,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono, monospace)',
          lineHeight: 1.7,
        }}>
          {expandedContent}
        </div>
      )}
    </div>
  );
}

function CompileSection({ data }: { data: CompileAuditData }) {
  const budgetPct = data.context_budget > 0
    ? Math.round((data.context_tokens / data.context_budget) * 100)
    : 0;
  const budgetBarColor = budgetPct > 80 ? '#ef4444' : budgetPct > 60 ? '#eab308' : 'var(--accent-primary)';

  return (
    <Section
      title="compile"
      collapsed={`\uD83E\uDDE0 Compiled ${data.decisions_passed} decisions + ${data.user_facts_loaded} user facts in ${data.duration_ms}ms`}
      onToggle={() => {}}
      expandedContent={
        <>
          <div>Decisions: {data.decisions_scanned} scanned \u2192 {data.decisions_passed} passed threshold</div>

          {data.top_decisions.length > 0 && (
            <div style={{ margin: '6px 0' }}>
              <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-secondary)' }}>Top decisions:</div>
              {data.top_decisions.slice(0, 3).map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '1px 0' }}>
                  <span style={{ color: scoreColor(d.score), fontWeight: 600, minWidth: 42 }}>{d.score.toFixed(3)}</span>
                  <span style={{ color: scoreColor(d.freshness), fontSize: 11, minWidth: 30 }}>f:{d.freshness.toFixed(2)}</span>
                  <span style={{ fontSize: 11, opacity: 0.7, minWidth: 24 }}>[{d.tier.slice(0, 4)}]</span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'inherit' }}>{d.title}</span>
                </div>
              ))}
            </div>
          )}

          {data.user_facts.length > 0 && (
            <div style={{ margin: '6px 0' }}>
              <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-secondary)' }}>User facts:</div>
              {data.user_facts.slice(0, 5).map((f, i) => (
                <div key={i} style={{ padding: '1px 0' }}>
                  <span style={{ color: 'var(--accent-primary)' }}>{f.key}</span>
                  <span style={{ opacity: 0.5 }}> = </span>
                  <span>{f.value}</span>
                  <span style={{ opacity: 0.4, fontSize: 10 }}> ({f.category})</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ margin: '6px 0' }}>
            <div style={{ marginBottom: 3 }}>Context: {data.context_tokens.toLocaleString()} / {data.context_budget.toLocaleString()} tokens ({budgetPct}%)</div>
            <div style={{
              height: 6,
              background: 'var(--bg-secondary)',
              borderRadius: 3,
              overflow: 'hidden',
              maxWidth: 200,
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, budgetPct)}%`,
                background: budgetBarColor,
                borderRadius: 3,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        </>
      }
    />
  );
}

function ToolsSection({ tools, streamEnd }: { tools: ToolCallInfo[]; streamEnd?: StreamEndData }) {
  const completedTools = tools.filter(t => t.status !== 'started');
  const outputTokens = streamEnd?.tokens?.output ?? 0;

  return (
    <Section
      title="tools"
      collapsed={`\u26A1 ${completedTools.length} tool call${completedTools.length !== 1 ? 's' : ''}${outputTokens > 0 ? `, ${outputTokens} output tokens` : ''} in ${streamEnd?.duration_seconds ?? 0}s`}
      onToggle={() => {}}
      expandedContent={
        <>
          {streamEnd?.model && (
            <div style={{ marginBottom: 4 }}>Model: {streamEnd.model} / anthropic</div>
          )}
          {streamEnd?.tokens && (
            <div style={{ marginBottom: 4 }}>
              Tokens: {streamEnd.tokens.input?.toLocaleString() ?? '?'} in / {streamEnd.tokens.output?.toLocaleString() ?? '?'} out
            </div>
          )}
          {completedTools.length > 0 && (
            <div style={{ margin: '4px 0' }}>
              {completedTools.map((tool, i) => {
                const statusIcon = tool.status === 'completed' ? '\u2705' : '\u274C';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                    <span>{tool.tool_emoji || '\uD83D\uDD27'}</span>
                    <span style={{ fontWeight: 500 }}>{tool.tool_name}</span>
                    {tool.args_preview && (
                      <span style={{ opacity: 0.5, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tool.args_preview}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>
                      {statusIcon} {tool.duration_ms != null ? `${tool.duration_ms}ms` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {completedTools.length === 0 && (
            <div style={{ opacity: 0.5 }}>No tool calls this turn</div>
          )}
        </>
      }
    />
  );
}

function CaptureSection({ data }: { data: CaptureAuditData }) {
  return (
    <Section
      title="capture"
      collapsed={`\uD83D\uDCBE Captured ${data.transcript_tokens} tokens \u2192 distillery ${data.distillery_status}`}
      onToggle={() => {}}
      expandedContent={
        <>
          <div>Transcript: {data.transcript_tokens} tokens</div>
          <div>Distillery: {data.distillery_status}</div>
          {data.facts_extracted > 0 && <div>Facts extracted: {data.facts_extracted}</div>}
          {data.decisions_extracted > 0 && <div>Decisions extracted: {data.decisions_extracted}</div>}
          <div>Duration: {data.duration_ms}ms</div>
        </>
      }
    />
  );
}

export function ProcessAuditTrail({ data, sessionCostUsd }: ProcessAuditTrailProps) {
  const [visible, setVisible] = useState(false);
  const hasData = data.compile || data.capture || (data.toolCalls && data.toolCalls.length > 0) || data.streamEnd;

  if (!hasData) return null;

  const turnCost = data.streamEnd?.cost_estimate_usd ?? 0;

  return (
    <div style={{ maxWidth: '80%', marginBottom: 12 }}>
      <button
        onClick={() => setVisible(!visible)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          padding: '2px 4px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span>{'\uD83D\uDD0D'}</span>
        <span>{visible ? 'Hide process' : 'Show process'}</span>
      </button>

      {visible && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)',
          borderRadius: 8,
          padding: '10px 12px',
          marginTop: 4,
        }}>
          {data.compile && <CompileSection data={data.compile} />}
          {(data.toolCalls || data.streamEnd) && (
            <ToolsSection tools={data.toolCalls || []} streamEnd={data.streamEnd} />
          )}
          {data.capture && <CaptureSection data={data.capture} />}

          {/* Cost line — always visible when trail is open */}
          <div style={{
            display: 'flex',
            gap: 12,
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            padding: '4px 0 0',
            borderTop: '1px solid var(--border-light)',
            marginTop: 6,
            color: 'var(--text-tertiary)',
          }}>
            <span style={{ color: costColor(turnCost) }}>
              ${turnCost.toFixed(4)} this turn
            </span>
            <span>
              ${sessionCostUsd.toFixed(4)} session
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
