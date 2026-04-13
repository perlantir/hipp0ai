import React, { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WingStats {
  agent_name: string;
  wing: string;
  decision_count: number;
  top_domains: string[];
  cross_wing_connections: Array<{ wing: string; strength: number }>;
  wing_affinity: {
    cross_wing_weights: Record<string, number>;
    last_recalculated: string;
    feedback_count: number;
  };
}

interface ProjectWing {
  wing: string;
  decision_count: number;
  top_domains: string[];
  cross_references: Array<{ agent: string; strength: number }>;
  agent_affinities?: Array<{ agent: string; affinity: number }>;
}

interface ProjectWingsResponse {
  project_id: string;
  wings: ProjectWing[];
}

interface AgentAffinityResponse {
  agent_id: string;
  agent_name: string;
  wing_affinity: {
    cross_wing_weights: Record<string, number>;
    last_recalculated: string;
    feedback_count: number;
  };
  wings: Array<{
    wing: string;
    affinity_score: number;
    trend: { positive: number; negative: number; total: number };
  }>;
  strongest_wing: string | null;
  feedback_count: number;
  last_recalculated: string;
}

/* ------------------------------------------------------------------ */
/*  Wing badge color                                                    */
/* ------------------------------------------------------------------ */

const WING_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

export function wingColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return WING_COLORS[Math.abs(hash) % WING_COLORS.length];
}

export function WingBadge({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const color = wingColor(name);
  const px = size === 'md' ? '8px 14px' : '2px 8px';
  const fs = size === 'md' ? 13 : 11;
  return (
    <span style={{
      display: 'inline-block', padding: px, borderRadius: 4,
      backgroundColor: color + '22', color, fontWeight: 600, fontSize: fs,
      border: `1px solid ${color}44`,
    }}>
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated affinity bar                                               */
/* ------------------------------------------------------------------ */

function AffinityBar({ value, label, showTrend }: { value: number; label: string; showTrend?: { positive: number; negative: number; total: number } }) {
  const pct = Math.round(value * 100);
  const barColor = value >= 0.7 ? '#10b981' : value >= 0.4 ? '#f59e0b' : '#6b7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <WingBadge name={label} />
      <div style={{ flex: 1, height: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', backgroundColor: barColor, borderRadius: 4,
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          animation: 'affinityPulse 2s ease-in-out infinite',
        }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-secondary, #9ca3af)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
      {showTrend && showTrend.total > 0 && (
        <span style={{ fontSize: 10, color: showTrend.positive > showTrend.negative ? '#10b981' : '#ef4444', minWidth: 30 }}>
          {showTrend.positive > showTrend.negative ? '↑' : '↓'}{showTrend.total}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wing Relationship Graph (simple SVG)                                */
/* ------------------------------------------------------------------ */

function WingRelationshipGraph({ wings }: { wings: ProjectWing[] }) {
  if (wings.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>No wings found</p>;

  const cx = 250, cy = 200, r = 140;
  const nodes = wings.map((w, i) => {
    const angle = (2 * Math.PI * i) / wings.length - Math.PI / 2;
    return { ...w, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  // Build edges from cross_references
  const edges: Array<{ from: typeof nodes[0]; to: typeof nodes[0]; strength: number }> = [];
  for (const node of nodes) {
    for (const ref of node.cross_references ?? []) {
      const target = nodes.find((n) => n.wing === ref.agent);
      if (target && ref.strength > 0) {
        edges.push({ from: node, to: target, strength: ref.strength });
      }
    }
  }

  return (
    <svg width="500" height="400" viewBox="0 0 500 400" style={{ maxWidth: '100%' }}>
      {/* Edges */}
      {edges.map((e, i) => (
        <line
          key={`edge-${i}`}
          x1={e.from.x} y1={e.from.y}
          x2={e.to.x} y2={e.to.y}
          stroke={`rgba(59, 130, 246, ${Math.max(0.15, e.strength)})`}
          strokeWidth={Math.max(1, e.strength * 4)}
        />
      ))}
      {/* Nodes */}
      {nodes.map((n) => {
        const color = wingColor(n.wing);
        const radius = Math.max(16, Math.min(30, 10 + n.decision_count * 0.5));
        return (
          <g key={n.wing}>
            <circle cx={n.x} cy={n.y} r={radius} fill={color + '33'} stroke={color} strokeWidth={2} />
            <text
              x={n.x} y={n.y + radius + 14}
              textAnchor="middle"
              fill="var(--text-primary, #e5e7eb)"
              fontSize={11}
              fontWeight={600}
            >
              {n.wing}
            </text>
            <text
              x={n.x} y={n.y + 4}
              textAnchor="middle"
              fill={color}
              fontSize={10}
              fontWeight={700}
            >
              {n.decision_count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent Affinity Chart (bar chart)                                    */
/* ------------------------------------------------------------------ */

function AgentAffinityChart({ agentName }: { agentName: string }) {
  const { get } = useApi();
  const [data, setData] = useState<AgentAffinityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    get<AgentAffinityResponse>(`/api/agents/${encodeURIComponent(agentName)}/affinity`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentName, get]);

  if (loading) return <div style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)' }}>Loading affinity data...</div>;
  if (!data || data.wings.length === 0) return <div style={{ padding: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>No affinity data yet</div>;

  const maxScore = Math.max(...data.wings.map((w) => w.affinity_score), 0.01);

  return (
    <div style={{ padding: 12 }}>
      <h4 style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 10 }}>WING AFFINITY SCORES</h4>
      {data.wings.slice(0, 8).map((w) => (
        <div key={w.wing} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: wingColor(w.wing), minWidth: 60, fontWeight: 600 }}>{w.wing}</span>
          <div style={{ flex: 1, height: 16, backgroundColor: 'var(--bg-tertiary)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              width: `${(w.affinity_score / maxScore) * 100}%`,
              height: '100%',
              backgroundColor: wingColor(w.wing) + '88',
              borderRadius: 4,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 40, textAlign: 'right' }}>
            {Math.round(w.affinity_score * 100)}%
          </span>
          {w.trend.total > 0 && (
            <span style={{ fontSize: 10, color: w.trend.positive > w.trend.negative ? '#10b981' : '#ef4444' }}>
              +{w.trend.positive}/-{w.trend.negative}
            </span>
          )}
        </div>
      ))}
      {data.last_recalculated && (
        <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8 }}>
          Last recalculated: {new Date(data.last_recalculated).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent Wing Detail                                                   */
/* ------------------------------------------------------------------ */

function AgentWingDetail({ agentName, onClose }: { agentName: string; onClose: () => void }) {
  const { get, post } = useApi();
  const { projectId } = useProject();
  const [stats, setStats] = useState<WingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebalancing, setRebalancing] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<WingStats>(`/api/agents/${encodeURIComponent(agentName)}/wing?project_id=${projectId}`);
      setStats(data);
    } catch { /* skip */ }
    setLoading(false);
  }, [agentName, projectId, get]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleRebalance = async () => {
    setRebalancing(true);
    try {
      await post(`/api/agents/${encodeURIComponent(agentName)}/wing/rebalance?project_id=${projectId}`, {});
      await loadStats();
    } catch { /* skip */ }
    setRebalancing(false);
  };

  if (loading) return <div style={{ padding: 20, color: 'var(--text-secondary)' }}>Loading wing data...</div>;
  if (!stats) return <div style={{ padding: 20, color: 'var(--text-secondary)' }}>No wing data found</div>;

  const wingAffinity = stats.wing_affinity ?? { cross_wing_weights: {}, feedback_count: 0, last_recalculated: '' };
  const topDomains: string[] = stats.top_domains ?? [];
  const crossConnections: Array<{ wing: string; strength: number }> = stats.cross_wing_connections ?? [];
  const sortedWeights = Object.entries(wingAffinity.cross_wing_weights ?? {})
    .sort(([, a], [, b]) => (b as number) - (a as number));

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary, #e5e7eb)', fontSize: 18, fontWeight: 700 }}>
          Wing: <WingBadge name={stats.agent_name} size="md" />
        </h3>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, padding: '6px 12px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>x</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{stats.decision_count}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Decisions</div>
        </div>
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{sortedWeights.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Cross-wing links</div>
        </div>
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{wingAffinity.feedback_count ?? 0}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Feedback events</div>
        </div>
      </div>

      {topDomains.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ color: 'var(--text-tertiary)', fontSize: 11, marginBottom: 8, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>Specialization</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            {topDomains.map((d) => (
              <span key={d} style={{ padding: '4px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 500, border: '1px solid rgba(255,255,255,0.3)' }}>{d}</span>
            ))}
          </div>
        </div>
      )}

      {/* Cross-wing relationship display */}
      {crossConnections.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ color: 'var(--text-tertiary)', fontSize: 11, marginBottom: 8, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>Cross-Wing Relationships</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {crossConnections.map((conn) => (
              <span key={conn.wing} style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12,
                background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)',
                border: `1px solid ${wingColor(conn.wing)}44`,
                fontWeight: 500,
              }}>
                {stats.agent_name} ↔ {conn.wing}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h4 style={{ color: 'var(--text-tertiary)', fontSize: 11, margin: 0, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>Cross-Wing Affinity</h4>
          <button
            onClick={handleRebalance}
            disabled={rebalancing}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)',
              border: '1px solid rgba(255,255,255,0.4)',
              opacity: rebalancing ? 0.5 : 1,
              fontWeight: 600,
            }}
          >
            {rebalancing ? 'Rebalancing...' : 'Rebalance'}
          </button>
        </div>
        {sortedWeights.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-tertiary, #6b7280)' }}>No cross-wing affinity data yet. Provide feedback to learn affinities.</p>
        ) : (
          sortedWeights.map(([wing, weight]) => (
            <AffinityBar key={wing} label={wing} value={weight} />
          ))
        )}
      </div>

      {/* Agent Affinity Chart */}
      <div style={{ marginTop: 20, background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(12px)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
        <AgentAffinityChart agentName={stats.agent_name} />
      </div>

      {wingAffinity.last_recalculated && (
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
          Last recalculated: {new Date(wingAffinity.last_recalculated).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main WingView                                                       */
/* ------------------------------------------------------------------ */

export function WingView() {
  const { get, post } = useApi();
  const { projectId } = useProject();
  const [wings, setWings] = useState<ProjectWing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const loadWings = useCallback(() => {
    setLoading(true);
    get<ProjectWingsResponse>(`/api/projects/${projectId}/wings`)
      .then((data) => setWings(data.wings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, get]);

  useEffect(() => { loadWings(); }, [loadWings]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await post(`/api/projects/${projectId}/wings/recalculate`, {});
      loadWings();
    } catch { /* skip */ }
    setRecalculating(false);
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading wing data...</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text-primary, #e5e7eb)', margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>Agent Wings</h2>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          style={{
            padding: '10px 20px', borderRadius: 12, fontSize: 13, cursor: 'pointer',
            backgroundColor: 'var(--accent-primary)', color: '#fff', fontWeight: 700,
            border: 'none', opacity: recalculating ? 0.6 : 1,
            boxShadow: '0 0 20px rgba(6,63,249,0.4)',
            transition: 'all 0.2s',
          }}
        >
          {recalculating ? 'Recalculating...' : 'Recalculate Wings'}
        </button>
      </div>
      <p style={{ color: 'var(--text-secondary, #9ca3af)', fontSize: 14, marginBottom: 24, fontWeight: 500 }}>
        Orchestrating specialized intelligence clusters and affinity pathways.
      </p>

      {selectedAgent ? (
        <AgentWingDetail agentName={selectedAgent} onClose={() => setSelectedAgent(null)} />
      ) : (
        <>
          {/* Wing Relationship Graph */}
          <div style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', borderRadius: 20, padding: 24, marginBottom: 28, border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 20px 40px rgba(0,0,0,0.05)' }}>
            <h3 style={{ color: 'var(--text-primary)', fontSize: 15, marginBottom: 16, fontWeight: 700 }}>Wing Relationship Graph</h3>
            <WingRelationshipGraph wings={wings} />
          </div>

          {/* Wing List */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {wings.map((w) => (
              <div
                key={w.wing}
                onClick={() => setSelectedAgent(w.wing)}
                style={{
                  padding: 20, borderRadius: 16, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.6)',
                  backdropFilter: 'blur(24px)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
                  transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = wingColor(w.wing); e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 25px 50px rgba(0,0,0,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 20px 40px rgba(0,0,0,0.05)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <WingBadge name={w.wing} size="md" />
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{w.decision_count}</span>
                </div>
                {w.top_domains.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                    {w.top_domains.map((d) => (
                      <span key={d} style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.5)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500, border: '1px solid rgba(255,255,255,0.3)' }}>{d}</span>
                    ))}
                  </div>
                )}
                {/* Agent affinities for this wing */}
                {w.agent_affinities && w.agent_affinities.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    Top affinity: {w.agent_affinities.slice(0, 2).map((a) => `${a.agent} (${Math.round(a.affinity * 100)}%)`).join(', ')}
                  </div>
                )}
                {(w.cross_references?.length ?? 0) > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Referenced by: {(w.cross_references ?? []).slice(0, 3).map((r) => r.agent).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
