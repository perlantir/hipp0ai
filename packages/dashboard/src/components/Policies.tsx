import React, { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle, Info, Pencil, XCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface Policy {
  id: string;
  decision_id: string;
  decision_title: string;
  enforcement: string;
  approved_by: string;
  category: string;
  applies_to: string[] | string;
  violations_count: number;
  created_at: string;
}

const ENFORCEMENT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode; borderClass: string }> = {
  block: { label: 'ENFORCEMENT: BLOCK', color: '#DC2626', bg: '#FEE2E2', icon: <Shield size={14} />, borderClass: 'border-l-4 border-l-red-600' },
  warn: { label: 'ENFORCEMENT: WARN', color: '#D97706', bg: '#FEF3C7', icon: <AlertTriangle size={14} />, borderClass: 'border-l-4 border-l-amber-400' },
  advisory: { label: 'MONITOR ONLY', color: '#6B7280', bg: '#F3F4F6', icon: <Info size={14} />, borderClass: 'border-l-4 border-l-slate-400' },
};

function PolicyCard({ policy, onDeactivate }: { policy: Policy; onDeactivate: (id: string) => void }) {
  const cfg = ENFORCEMENT_CONFIG[policy.enforcement] || ENFORCEMENT_CONFIG.advisory;
  const violations = typeof policy.violations_count === 'number' ? policy.violations_count : parseInt(String(policy.violations_count) || '0', 10);

  let appliesTo: string[] = [];
  if (Array.isArray(policy.applies_to)) appliesTo = policy.applies_to;
  else if (typeof policy.applies_to === 'string') {
    try { appliesTo = JSON.parse(policy.applies_to); } catch { appliesTo = []; }
  }

  return (
    <div
      className={`card rounded-[2rem] p-8 group hover:shadow-xl transition-all ${cfg.borderClass}`}
    >
      <div className="flex items-start justify-between gap-2 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}>
            {cfg.icon}
          </div>
          <h4 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {policy.decision_title}
          </h4>
        </div>
        <span
          className="text-[10px] font-bold px-3 py-1.5 rounded-full shrink-0 flex items-center gap-2"
          style={{ background: cfg.bg, color: cfg.color }}
        >
          {cfg.icon}
          <span>{cfg.label}</span>
        </span>
      </div>

      <p className="text-[var(--text-secondary)] text-sm mb-8 leading-relaxed">
        {policy.category} policy. Approved by {policy.approved_by}.
      </p>

      <div className="flex flex-wrap gap-4 mb-8">
        <div className="card px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          <span className="text-[var(--text-secondary)]">Scope:</span>
          <span className="font-bold text-primary">{policy.category}</span>
        </div>
        <div className="card px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          <span className="text-[var(--text-secondary)]">Applied to:</span>
          <span className="font-bold">{appliesTo.length === 0 ? 'All Agents' : appliesTo.join(', ')}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-6 border-t border-[var(--border-light)]">
        <div className="flex items-center gap-12">
          <div>
            <span className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-1">Violation Count</span>
            <span className="text-2xl font-bold" style={{ color: violations > 0 ? '#DC2626' : 'var(--text-primary)' }}>{violations}</span>
          </div>
        </div>
        <button
          onClick={() => onDeactivate(policy.id)}
          className="text-primary font-bold flex items-center gap-2 hover:gap-3 transition-all text-sm"
        >
          <span>Deactivate</span>
        </button>
      </div>
    </div>
  );
}

export function Policies() {
  const { get, del } = useApi();
  const { projectId } = useProject();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPolicies = useCallback(() => {
    if (projectId === 'default') return;
    setLoading(true);
    get<Policy[]>(`/api/projects/${projectId}/policies`)
      .then(setPolicies)
      .catch(() => setPolicies([]))
      .finally(() => setLoading(false));
  }, [get, projectId]);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const handleDeactivate = async (id: string) => {
    try {
      await del(`/api/policies/${id}`);
      fetchPolicies();
    } catch { /* ignore */ }
  };

  const grouped = {
    block: policies.filter((p) => p.enforcement === 'block'),
    warn: policies.filter((p) => p.enforcement === 'warn'),
    advisory: policies.filter((p) => p.enforcement === 'advisory'),
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-8">
        <h2 className="text-4xl font-bold tracking-tight mb-4" style={{ color: 'var(--text-primary)' }}>Policy Monitoring</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-3xl animate-pulse" style={{ background: 'var(--bg-hover)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-8 space-y-12">
      {/* Hero Header Section */}
      <section className="flex justify-between items-end">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Policy Monitoring</h1>
          <p className="text-[var(--text-secondary)] max-w-xl text-lg">Define and manage governance rules to ensure architectural integrity across all intelligence agents and distributed systems.</p>
        </div>
      </section>

      {/* Stats Overview Row */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card p-6 rounded-[1.5rem] shadow-sm">
          <p className="text-[var(--text-secondary)] text-sm font-bold mb-1">ACTIVE POLICIES</p>
          <h3 className="text-3xl font-bold">{policies.length}</h3>
        </div>
        <div className="card p-6 rounded-[1.5rem] shadow-sm">
          <p className="text-[var(--text-secondary)] text-sm font-bold mb-1">BLOCK POLICIES</p>
          <h3 className="text-3xl font-bold text-red-600">{grouped.block.length}</h3>
        </div>
        <div className="card p-6 rounded-[1.5rem] shadow-sm">
          <p className="text-[var(--text-secondary)] text-sm font-bold mb-1">WARN POLICIES</p>
          <h3 className="text-3xl font-bold text-amber-600">{grouped.warn.length}</h3>
        </div>
        <div className="card p-6 rounded-[1.5rem] shadow-sm bg-primary/5" style={{ borderColor: 'rgba(6,63,249,0.2)' }}>
          <p className="text-primary text-sm font-bold mb-1">ADVISORY</p>
          <h3 className="text-3xl font-bold text-primary">{grouped.advisory.length}</h3>
        </div>
      </section>

      {policies.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
          <Shield size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No policies defined yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Approve a decision as policy from the decision detail view.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-12 gap-8">
          {(['block', 'warn', 'advisory'] as const).map((level) => {
            const items = grouped[level];
            if (items.length === 0) return null;
            const cfg = ENFORCEMENT_CONFIG[level];
            return (
              <div key={level} className="col-span-12 space-y-6">
                <h3
                  className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                  style={{ color: cfg.color }}
                >
                  {cfg.icon} {cfg.label} ({items.length})
                </h3>
                <div className="space-y-6">
                  {items.map((p) => (
                    <PolicyCard key={p.id} policy={p} onDeactivate={handleDeactivate} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
