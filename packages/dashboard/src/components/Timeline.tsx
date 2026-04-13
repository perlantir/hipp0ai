import { useEffect, useState, useCallback } from 'react';
import {
  Clock,
  User,
  Tag,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Loader2,
  Calendar,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { Decision, DecisionStatus } from '../types';
import { WingBadge } from './WingView';
import { ExportButton } from './ExportButton';

/* ------------------------------------------------------------------ */
/*  Validation sub-component                                           */
/* ------------------------------------------------------------------ */

const VALIDATION_SOURCES = ['manual_review', 'test_passed', 'production_verified', 'peer_reviewed', 'external'] as const;

function ValidationControls({
  decision,
  onUpdate,
}: {
  decision: Decision;
  onUpdate: () => void;
}) {
  const { post } = useApi();
  const [showValidate, setShowValidate] = useState(false);
  const [showInvalidate, setShowInvalidate] = useState(false);
  const [source, setSource] = useState<string>('manual_review');
  const [reason, setReason] = useState('');

  const isValidated = !!decision.validated_at;

  const handleValidate = async () => {
    await post(`/api/decisions/${decision.id}/validate`, { validation_source: source });
    setShowValidate(false);
    onUpdate();
  };

  const handleInvalidate = async () => {
    await post(`/api/decisions/${decision.id}/invalidate`, { reason: reason || undefined });
    setShowInvalidate(false);
    setReason('');
    onUpdate();
  };

  return (
    <div className="mt-4 pt-4 border-t border-white/20">
      {/* Status display */}
      <div className="flex items-center gap-2 mb-2 text-xs">
        {isValidated ? (
          <span className="flex items-center gap-1 text-green-600">
            <span>✅</span>
            Validated via {(decision.validation_source ?? '').replace(/_/g, ' ')}
            {decision.validated_at && (
              <span className="text-[#6B7280] ml-1">
                on {new Date(decision.validated_at ?? '').toLocaleDateString()}
              </span>
            )}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[#6B7280]">
            <span>⏳</span> Not yet validated
          </span>
        )}
      </div>

      {/* Action buttons */}
      {decision?.status === 'active' && (
        <div className="flex gap-2">
          {!showValidate && !showInvalidate && (
            <>
              <button
                onClick={() => setShowValidate(true)}
                className="px-2 py-1 rounded text-2xs bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                Validate
              </button>
              {isValidated && (
                <button
                  onClick={() => setShowInvalidate(true)}
                  className="px-2 py-1 rounded text-2xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                >
                  Invalidate
                </button>
              )}
            </>
          )}

          {showValidate && (
            <div className="flex items-center gap-2">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="px-2 py-1 rounded-lg text-2xs border"
                style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}
              >
                {VALIDATION_SOURCES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button onClick={handleValidate} className="px-2 py-1 rounded text-2xs bg-green-500/20 text-green-400">Confirm</button>
              <button onClick={() => setShowValidate(false)} className="px-2 py-1 rounded-lg text-2xs" style={{ background: 'rgba(255,255,255,0.5)' }}>Cancel</button>
            </div>
          )}

          {showInvalidate && (
            <div className="flex items-center gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className="px-2 py-1 rounded-lg text-2xs border w-48"
                style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}
              />
              <button onClick={handleInvalidate} className="px-2 py-1 rounded text-2xs bg-red-500/20 text-red-400">Confirm</button>
              <button onClick={() => setShowInvalidate(false)} className="px-2 py-1 rounded-lg text-2xs" style={{ background: 'rgba(255,255,255,0.5)' }}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadgeClass(status: DecisionStatus) {
  const base = 'flex items-center gap-1 text-[10px] font-bold uppercase';
  switch (status) {
    case 'active':
      return `${base} text-green-600`;
    case 'superseded':
      return `${base} text-slate-500`;
    case 'reverted':
      return `${base} text-red-600`;
    default:
      return `${base} text-amber-600`;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Timeline() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Expanded supersession chains
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());

  const fetchDecisions = useCallback((pageNum: number = page) => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(pageNum * PAGE_SIZE));
    if (filterAgent) params.set('made_by', filterAgent);
    return get<Decision[]>(`/api/projects/${projectId}/decisions?${params}`)
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setDecisions(arr);
        // If we got a full page, there's likely more
        if (arr.length === PAGE_SIZE && pageNum === 0) {
          // Fetch total count separately
          get<Decision[]>(`/api/projects/${projectId}/decisions?limit=1&offset=0`)
            .then(() => setTotalCount(Math.max(totalCount, (pageNum + 1) * PAGE_SIZE + 1)))
            .catch(() => {});
        } else if (arr.length < PAGE_SIZE) {
          setTotalCount(pageNum * PAGE_SIZE + arr.length);
        }
        return arr;
      });
  }, [get, projectId, page, filterAgent, totalCount]);

  const refreshDecisions = () => fetchDecisions().catch(() => {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchDecisions()
      .then(() => { if (!cancelled) setLoading(false); })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load decisions');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [fetchDecisions]);

  const agents = Array.from(new Set(decisions.map((d) => d.made_by)));
  const allTags = Array.from(new Set(decisions.flatMap((d) => d.tags)));

  /* ---- Filtering ------------------------------------------------- */
  const filtered = decisions
    .filter((d) => {
      if (filterAgent && d.made_by !== filterAgent) return false;
      if (filterTag && !d.tags.includes(filterTag)) return false;
      if (filterScope && d.temporal_scope !== filterScope) return false;
      if (dateFrom && d.created_at < dateFrom) return false;
      if (dateTo && d.created_at > dateTo) return false;
      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  /* ---- Supersession chains --------------------------------------- */
  function getChain(decision: Decision): Decision[] {
    const chain: Decision[] = [];
    let current: Decision | undefined = decision;
    while (current?.supersedes) {
      const parent = decisions.find((d) => d.id === current!.supersedes);
      if (parent && !chain.find((c) => c.id === parent.id)) {
        chain.push(parent);
        current = parent;
      } else break;
    }
    return chain;
  }

  function hasContradiction(decision: Decision): boolean {
    return decision.relationships?.some((r) => r.type === 'conflicts_with') ?? false;
  }

  function toggleChain(id: string) {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ---- Loading / Error ------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={28} className="animate-spin text-[#063ff9]" />
          <span className="text-base text-[#6B7280] font-medium">Loading timeline…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-8 max-w-md text-center rounded-3xl shadow-sm" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
          <p className="text-base text-red-600 font-bold">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            Decision Timeline
            {totalCount > 0 && <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-tertiary)' }}>({totalCount} decisions)</span>}
          </h1>
          <p className="text-xl text-[#6B7280] max-w-2xl">
            Audit the trail of autonomous reasoning across your multi-agent architecture.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-12 rounded-2xl p-6 shadow-sm" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}>
            <User size={14} className="text-[#6B7280]" />
            <select
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-sm font-medium text-[#1A1D27] p-0"
            >
              <option value="">All Agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}>
            <Tag size={14} className="text-[#6B7280]" />
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-sm font-medium text-[#1A1D27] p-0"
            >
              <option value="">All Tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}>
            <select
              value={filterScope}
              onChange={(e) => setFilterScope(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-sm font-medium text-[#1A1D27] p-0"
            >
              <option value="">All Scopes</option>
              <option value="permanent">Permanent</option>
              <option value="sprint">Sprint</option>
              <option value="experiment">Experiment</option>
              <option value="deprecated">Deprecated</option>
            </select>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}>
            <Calendar
              size={14}
              className="text-[#6B7280]"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-sm font-medium text-[#1A1D27] p-0"
              placeholder="From"
            />
            <span className="text-[#6B7280] text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-sm font-medium text-[#1A1D27] p-0"
              placeholder="To"
            />
          </div>

          <div className="ml-auto">
            <ExportButton data={filtered} filename="hipp0-timeline" />
          </div>
        </div>

        {/* Timeline */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Clock
              size={32}
              className="mx-auto mb-3 text-[#6B7280]"
            />
            <p className="text-base text-[#6B7280]">
              No decisions match the current filters
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[24px] top-0 bottom-0 w-px" style={{ background: 'linear-gradient(to bottom, transparent, #063ff933, transparent)' }} />

            <div className="space-y-6">
              {filtered.map((decision) => {
                const chain = getChain(decision);
                const isContradiction = hasContradiction(decision);
                const isExpanded = expandedChains.has(decision.id);

                return (
                  <div key={decision.id} className="relative pl-12">
                    {/* Dot on timeline */}
                    <div
                      className="absolute left-[18px] top-8 w-3.5 h-3.5 rounded-full border-2 border-white"
                      style={{
                        backgroundColor:
                          decision?.status === 'active'
                            ? '#10b981'
                            : decision?.status === 'superseded'
                              ? '#64748b'
                              : decision?.status === 'reverted'
                                ? '#ef4444'
                                : '#063ff9',
                      }}
                    />

                    {/* Card */}
                    <div
                      className={`p-8 rounded-3xl hover:translate-x-2 transition-all duration-300 group shadow-sm ${
                        isContradiction ? 'ring-1 ring-red-500/40 border-l-4 border-l-red-500' : ''
                      }`}
                      style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            {(decision.wing ?? decision.made_by) && (
                              <span className="px-2 py-0.5 bg-[#063ff9]/10 text-[#063ff9] text-[10px] font-bold rounded uppercase tracking-tighter">
                                {decision.wing ?? decision.made_by}
                              </span>
                            )}
                            <span className={statusBadgeClass(decision.status)}>{decision.status}</span>
                            {decision.validated_at && (
                              <span className="text-green-400 text-xs" title={`Validated: ${decision.validation_source}`}>✅</span>
                            )}
                            {decision.temporal_scope && decision.temporal_scope !== 'permanent' && (
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  decision.temporal_scope === 'sprint'
                                    ? 'bg-[#063ff9]/10 text-[#063ff9]'
                                    : decision.temporal_scope === 'experiment'
                                      ? 'bg-purple-500/15 text-purple-400'
                                      : 'bg-gray-500/15 text-gray-400'
                                }`}
                              >
                                {decision.temporal_scope}
                              </span>
                            )}
                            {decision.namespace && (
                              <span style={{
                                display: 'inline-block', padding: '1px 6px', borderRadius: 9999, fontSize: 10, fontWeight: 700,
                                backgroundColor: '#063ff915', color: '#063ff9', border: '1px solid #063ff930',
                                textTransform: 'uppercase',
                              }}>
                                ns:{decision.namespace}
                              </span>
                            )}
                          </div>
                          <h2 className="text-2xl font-bold leading-tight">
                            {decision.title}
                          </h2>
                        </div>
                        <span className="text-[#6B7280] text-sm font-medium whitespace-nowrap">
                          {formatDate(decision.created_at)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#6B7280] mb-2">
                        {decision.valid_until && (
                          <span className="text-red-600 font-bold">
                            Expired {formatDate(decision.valid_until)}
                          </span>
                        )}
                        {decision.superseded_by && (
                          <span className="text-slate-500">
                            Superseded
                          </span>
                        )}
                      </div>

                      {/* Tags */}
                      {decision.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-6">
                          {decision.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-3 py-1 rounded-full text-xs font-medium text-[#6B7280] border"
                              style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Contradiction warning */}
                      {isContradiction && (
                        <p className="text-xs text-red-600 font-bold mb-4">
                          ⚠ This decision has conflicts
                        </p>
                      )}

                      {/* Supersession chain & card footer */}
                      <div className="flex items-center justify-between pt-6 border-t border-white/20">
                        <div className="flex gap-6">
                          {chain.length > 0 && (
                            <button
                              onClick={() => toggleChain(decision.id)}
                              className="flex items-center gap-2 text-[#6B7280] text-sm font-bold"
                            >
                              <ArrowRight size={18} />
                              {chain.length} related decision{chain.length > 1 ? 's' : ''}
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                          {isContradiction && (
                            <span className="flex items-center gap-2 text-red-600 text-sm font-bold">
                              ⚠ contradictions
                            </span>
                          )}
                        </div>
                        <button className="flex items-center gap-2 text-[#063ff9] font-bold text-sm group-hover:gap-3 transition-all">
                          Audit Logs <ArrowRight size={16} />
                        </button>
                      </div>

                      {chain.length > 0 && isExpanded && (
                        <div className="mt-4 ml-4 space-y-2 animate-fade-in">
                          {chain.map((prev) => (
                            <div
                              key={prev.id}
                              className="p-3 rounded-xl text-xs"
                              style={{ background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.3)' }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{prev.title}</span>
                                <span className={statusBadgeClass(prev.status)}>
                                  {prev.status}
                                </span>
                              </div>
                              <span className="text-[#6B7280] mt-1 block">
                                {formatDate(prev.created_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Validation controls */}
                      <ValidationControls decision={decision} onUpdate={refreshDecisions} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div className="flex justify-center py-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => { setPage((p) => Math.max(0, p - 1)); }}
                disabled={page === 0}
                className="px-8 py-4 rounded-2xl font-bold disabled:opacity-30 hover:bg-white transition-all shadow-sm"
                style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}
              >
                Previous
              </button>
              <span className="text-sm font-medium text-[#6B7280]">
                Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
              </span>
              <button
                onClick={() => { setPage((p) => p + 1); }}
                disabled={(page + 1) * PAGE_SIZE >= totalCount}
                className="px-8 py-4 rounded-2xl font-bold disabled:opacity-30 hover:bg-white transition-all shadow-sm"
                style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
