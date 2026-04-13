import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

const ACTION_BADGE_COLORS: Record<string, string> = {
  PROCEED: '#10b981',
  PROCEED_WITH_NOTE: '#f59e0b',
  SKIP: '#6b7280',
  OVERRIDE_TO: '#3b82f6',
  ASK_FOR_CLARIFICATION: '#eab308',
};

function ActionTag({ action }: { action?: string }) {
  if (!action) return null;
  const color = ACTION_BADGE_COLORS[action] || '#6b7280';
  const label = action === 'PROCEED_WITH_NOTE' ? 'NOTE' : action;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginRight: 6,
      backgroundColor: color + '22', color, fontWeight: 600, fontSize: 11,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}


interface RoleSignal {
  agent_name: string;
  should_participate: boolean;
  abstain_probability: number;
  role_suggestion: string;
  reason: string;
  relevance_score: number;
  rank_among_agents: number;
  total_agents: number;
}

interface TeamRelevance {
  task_description: string;
  recommended_participants: RoleSignal[];
  recommended_skip: RoleSignal[];
  optimal_team_size: number;
}

function getRowColor(abstainProbability: number): string {
  if (abstainProbability < 0.3) return 'var(--success, #22c55e)';
  if (abstainProbability <= 0.7) return 'var(--warning, #f59e0b)';
  return 'var(--text-tertiary, #6b7280)';
}

function getRowBg(abstainProbability: number): string {
  if (abstainProbability < 0.3) return 'rgba(34, 197, 94, 0.08)';
  if (abstainProbability <= 0.7) return 'rgba(245, 158, 11, 0.08)';
  return 'rgba(107, 114, 128, 0.05)';
}

export function TeamScore() {
  const { post } = useApi();
  const { projectId } = useProject();
  const [taskDescription, setTaskDescription] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [result, setResult] = useState<TeamRelevance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScore = async () => {
    if (!taskDescription.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await post<TeamRelevance>(`/api/projects/${projectId}/team-score`, {
        task_description: taskDescription,
        ...(sessionId ? { session_id: sessionId } : {}),
      });
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to score team');
    } finally {
      setLoading(false);
    }
  };

  const allSignals = result
    ? [...result.recommended_participants, ...result.recommended_skip]
        .sort((a, b) => a.rank_among_agents - b.rank_among_agents)
    : [];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        Team Score
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        Score all agents for a task to see participation recommendations, role suggestions, and abstention probabilities.
      </p>

      {/* Input */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Describe the task..."
          value={taskDescription}
          onChange={(e) => setTaskDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScore()}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
          }}
        />
        <input
          type="text"
          placeholder="Session ID (optional)"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          style={{
            width: 220,
            padding: '0.5rem 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
          }}
        />
        <button
          onClick={handleScore}
          disabled={loading || !taskDescription.trim()}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            background: 'var(--accent, #f59e0b)',
            color: '#fff',
            border: 'none',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            opacity: loading || !taskDescription.trim() ? 0.6 : 1,
          }}
        >
          {loading ? 'Scoring...' : 'Score'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'var(--error, #ef4444)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          <div style={{
            display: 'flex', gap: '1.5rem', marginBottom: '1rem',
            fontSize: '0.8125rem', color: 'var(--text-secondary)',
          }}>
            <span>Optimal team size: <strong style={{ color: 'var(--text-primary)' }}>{result.optimal_team_size}</strong></span>
            <span>Participate: <strong style={{ color: 'var(--success, #22c55e)' }}>{result.recommended_participants.length}</strong></span>
            <span>Skip: <strong style={{ color: 'var(--text-tertiary, #6b7280)' }}>{result.recommended_skip.length}</strong></span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 500 }}>Rank</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 500 }}>Agent</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 500 }}>Role Suggestion</th>
                <th style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 500 }}>Relevance</th>
                <th style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 500 }}>Abstain %</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 500 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {allSignals.map((s) => (
                <tr
                  key={s.agent_name}
                  style={{ borderBottom: '1px solid var(--border)', background: getRowBg(s.abstain_probability) }}
                >
                  <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{s.rank_among_agents}</td>
                  <td style={{ padding: '0.5rem', fontWeight: 500, color: 'var(--text-primary)' }}>{s.agent_name}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.125rem 0.5rem',
                      borderRadius: '0.25rem',
                      background: 'var(--bg-secondary)',
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                    }}>
                      {s.role_suggestion}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                    {(s.relevance_score * 100).toFixed(0)}%
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', color: getRowColor(s.abstain_probability) }}>
                    {(s.abstain_probability * 100).toFixed(0)}%
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{
                      display: 'inline-block',
                      width: 8, height: 8,
                      borderRadius: '50%',
                      background: getRowColor(s.abstain_probability),
                      marginRight: '0.375rem',
                      verticalAlign: 'middle',
                    }} />
                    <span style={{ color: getRowColor(s.abstain_probability), fontSize: '0.75rem' }}>
                      {s.should_participate ? 'Participate' : 'Skip'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
