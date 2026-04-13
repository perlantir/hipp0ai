import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, AlertTriangle, AlertOctagon, Info, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface Finding {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  recommendation: string;
  data: Record<string, unknown>;
}

interface DigestSummary {
  period: string;
  findings_count: number;
  critical: number;
  warnings: number;
  overall_health: 'good' | 'fair' | 'needs_attention';
}

interface Digest {
  id: string;
  findings: Finding[];
  summary: DigestSummary;
  generated_at: string;
}

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  critical: <AlertOctagon size={14} style={{ color: '#DC2626' }} />,
  warning: <AlertTriangle size={14} style={{ color: '#D97706' }} />,
  info: <Info size={14} style={{ color: '#6B8AE5' }} />,
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: '#DC2626',
  warning: '#D97706',
  info: '#6B8AE5',
};

const HEALTH_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  good: { label: 'Good', color: '#16A34A', bg: '#D1FAE5' },
  fair: { label: 'Fair', color: '#D97706', bg: '#FEF3C7' },
  needs_attention: { label: 'Needs Attention', color: '#DC2626', bg: '#FEE2E2' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function FindingCard({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="card rounded-3xl p-6 hover:shadow-xl transition-all"
      style={{
        borderLeft: `4px solid ${SEVERITY_BORDER[finding.severity]}`,
      }}
    >
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="mt-0.5 shrink-0">{SEVERITY_ICON[finding.severity]}</span>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: SEVERITY_BORDER[finding.severity] }}>
            {finding.severity}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>
            {finding.title}
          </p>
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>
      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
            {finding.description}
          </p>
          <div className="bg-white/40 rounded-2xl p-4 border border-white/60">
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Recommendation</p>
            <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {finding.recommendation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function WeeklyDigest() {
  const { get, post } = useApi();
  const { projectId } = useProject();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchDigest = useCallback(() => {
    if (projectId === 'default') return;
    setLoading(true);
    get<Digest>(`/api/projects/${projectId}/digest`)
      .then(setDigest)
      .catch(() => setDigest(null))
      .finally(() => setLoading(false));
  }, [get, projectId]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await post<Digest>(`/api/projects/${projectId}/digest/generate`, {});
      setDigest(result);
    } catch { /* silent */ }
    finally { setGenerating(false); }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-8">
        <h2 className="text-4xl font-bold tracking-tight mb-4" style={{ color: 'var(--text-primary)' }}>
          Weekly Digest
        </h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-3xl animate-pulse" style={{ background: 'var(--bg-hover)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-8">
      {/* Hero Section: Editorial Header */}
      <section className="mb-16">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="text-sm font-bold text-primary tracking-widest uppercase mb-4">Monitoring Intelligence</h2>
            <h1 className="text-6xl font-bold tracking-tight mb-4">Weekly Digest</h1>
            <p className="text-xl text-[var(--text-secondary)] max-w-2xl leading-relaxed">
              A synthesized analysis of architectural shifts, logic conflicts, and autonomous reasoning cycles.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {digest && (
              <div className="card p-6 rounded-3xl flex flex-col items-end">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">System Health</span>
                {(() => {
                  const h = HEALTH_CONFIG[digest.summary?.overall_health] || HEALTH_CONFIG.good;
                  return (
                    <span className="text-3xl font-bold" style={{ color: h.color }}>
                      {h.label}
                    </span>
                  );
                })()}
                <div className="flex gap-1 mt-2">
                  <div className="w-1 h-3 bg-primary rounded-full" />
                  <div className="w-1 h-3 bg-primary rounded-full" />
                  <div className="w-1 h-3 bg-primary rounded-full" />
                  <div className="w-1 h-3 bg-primary/20 rounded-full" />
                </div>
              </div>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-primary text-white px-6 py-3 rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(6,63,249,0.4)] hover:-translate-y-1 transition-all flex items-center gap-2"
              style={{ opacity: generating ? 0.7 : 1 }}
            >
              <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generating...' : 'Generate Now'}
            </button>
          </div>
        </div>
      </section>

      {!digest ? (
        <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
          <BarChart3 size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No digest generated yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Click "Generate Now" or wait for the weekly automatic run.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {/* Summary Stats Bento Grid */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="card p-8 rounded-3xl hover:translate-y-[-4px] transition-all cursor-default group">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                <BarChart3 size={20} />
              </div>
              <div className="text-4xl font-bold mb-1">{digest.summary?.findings_count ?? 0}</div>
              <div className="text-[var(--text-secondary)] font-medium">total findings</div>
            </div>
            <div className="card p-8 rounded-3xl hover:translate-y-[-4px] transition-all cursor-default group">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-6 text-red-500 group-hover:bg-red-500 group-hover:text-white transition-colors">
                <AlertOctagon size={20} />
              </div>
              <div className="text-4xl font-bold mb-1">{digest.summary?.critical ?? 0}</div>
              <div className="text-[var(--text-secondary)] font-medium">critical</div>
            </div>
            <div className="card p-8 rounded-3xl hover:translate-y-[-4px] transition-all cursor-default group">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-6 text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                <AlertTriangle size={20} />
              </div>
              <div className="text-4xl font-bold mb-1">{digest.summary?.warnings ?? 0}</div>
              <div className="text-[var(--text-secondary)] font-medium">warnings</div>
            </div>
            <div className="card p-8 rounded-3xl hover:translate-y-[-4px] transition-all cursor-default group">
              <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center mb-6 text-slate-600 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                <Info size={20} />
              </div>
              <div className="text-4xl font-bold mb-1">{digest.summary?.period ?? '7d'}</div>
              <div className="text-[var(--text-secondary)] font-medium">period</div>
            </div>
          </section>

          {/* Summary card */}
          <div className="card rounded-3xl p-6 bg-primary text-white">
            <div className="flex justify-between items-center mb-6">
              <span className="text-xs font-bold uppercase tracking-widest opacity-80">Generated</span>
              <span className="text-2xl font-bold">{timeAgo(digest.generated_at)}</span>
            </div>
            <div className="h-1 w-full bg-white/20 rounded-full mb-4">
              <div className="h-full bg-white rounded-full" style={{ width: `${digest.summary?.overall_health === 'good' ? 90 : digest.summary?.overall_health === 'fair' ? 60 : 30}%` }} />
            </div>
            <p className="text-xs opacity-80 italic">
              {digest.summary?.findings_count ?? 0} findings analyzed across the reporting period.
            </p>
          </div>

          {/* Findings */}
          {(!digest.findings || digest.findings.length === 0) ? (
            <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
              <p className="text-sm">No findings -- your project is in good shape.</p>
            </div>
          ) : (
            <div>
              <h3 className="text-2xl font-bold flex items-center gap-3 mb-8">
                <span className="w-2 h-8 bg-primary rounded-full" />
                Findings
              </h3>
              <div className="space-y-4">
                {digest.findings.map((f, i) => (
                  <FindingCard key={`${f.type}-${i}`} finding={f} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
