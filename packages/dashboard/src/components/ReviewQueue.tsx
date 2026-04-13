import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Edit3,
  Loader2,
  Inbox,
  ChevronDown,
  ChevronUp,
  Tag,
  User,
  AlertTriangle,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ReviewDecision {
  id: string;
  title: string;
  description: string;
  reasoning: string;
  tags: string[];
  confidence: string;
  made_by: string;
  source: string;
  created_at: string;
  review_status: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function confidenceBadge(confidence: string) {
  const colors: Record<string, string> = {
    high: 'bg-green-100 text-green-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-red-100 text-red-700',
  };
  return colors[confidence] ?? 'bg-slate-100 text-slate-600';
}

function confidenceBorderColor(confidence: string) {
  const colors: Record<string, string> = {
    high: 'border-green-500',
    medium: 'border-amber-400',
    low: 'border-rose-500',
  };
  return colors[confidence] ?? 'border-blue-500';
}

function confidenceIcon(confidence: string) {
  if (confidence === 'low') return 'text-amber-600';
  if (confidence === 'medium') return 'text-blue-600';
  return 'text-green-600';
}

/* ------------------------------------------------------------------ */
/*  Review Item                                                        */
/* ------------------------------------------------------------------ */

function ReviewItem({
  decision,
  onApprove,
  onReject,
}: {
  decision: ReviewDecision;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(decision.title);
  const [editDesc, setEditDesc] = useState(decision.description);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { patch } = useApi();

  async function handleApprove() {
    setActionLoading('approve');
    try {
      if (editing && (editTitle !== decision.title || editDesc !== decision.description)) {
        await patch(`/api/decisions/${decision.id}`, { title: editTitle, description: editDesc });
      }
      await onApprove(decision.id);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject() {
    setActionLoading('reject');
    try {
      await onReject(decision.id, rejectReason);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className={`card rounded-3xl p-6 border-l-[6px] ${confidenceBorderColor(decision.confidence)} hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 animate-slide-up`}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Metadata Column */}
        <div className="lg:w-1/4">
          <div className={`flex items-center gap-2 ${confidenceIcon(decision.confidence)} mb-3`}>
            <AlertTriangle size={16} />
            <span className="text-xs font-bold tracking-widest uppercase">
              {decision.confidence} confidence
            </span>
          </div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
              <User size={16} className="text-slate-600" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Agent Origin</p>
              <p className="text-sm font-bold">{decision.made_by}</p>
            </div>
          </div>
          {decision.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {decision.tags.map((tag) => (
                <span key={tag} className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Content Column */}
        <div className="lg:w-2/4">
          {editing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="input w-full text-xl font-bold mb-3"
            />
          ) : (
            <h3 className="text-xl font-bold mb-3">{decision.title}</h3>
          )}

          {expanded ? (
            <div className="space-y-3">
              {editing ? (
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="input w-full text-sm h-20 resize-y"
                />
              ) : (
                <>
                  {decision.description && (
                    <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4">{decision.description}</p>
                  )}
                  {decision.reasoning && (
                    <div className="bg-white/40 rounded-2xl p-4 border border-white/60">
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Reasoning</p>
                      <p className="text-xs text-[var(--text-secondary)]">{decision.reasoning}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {decision.description && (
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4 line-clamp-2">{decision.description}</p>
              )}
            </>
          )}
          <div className="flex items-center gap-3 mt-3">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase ${confidenceBadge(decision.confidence)}`}>
              {decision.confidence}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">
              {relativeTime(decision.created_at)}
            </span>
            <span className="text-xs text-[var(--text-tertiary)] capitalize">{decision.source}</span>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="ml-auto text-primary text-xs font-bold hover:underline"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {/* Actions Column */}
        <div className="lg:w-1/4 flex flex-col justify-center gap-3">
          <button
            onClick={handleApprove}
            disabled={!!actionLoading}
            className="w-full bg-primary text-white py-2.5 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-1.5"
          >
            {actionLoading === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Approve
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            className="w-full bg-white/80 border border-slate-200 py-2.5 rounded-xl font-bold text-sm hover:bg-white transition-all flex items-center justify-center gap-1.5"
          >
            <Edit3 size={14} />
            Edit & Approve
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowReject((v) => !v)}
              className="bg-rose-50 text-rose-600 py-2.5 rounded-xl font-bold text-[11px] hover:bg-rose-100 transition-all uppercase tracking-tight"
            >
              Reject
            </button>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="bg-slate-100 text-slate-600 py-2.5 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-all uppercase tracking-tight"
            >
              Revision
            </button>
          </div>
        </div>
      </div>

      {/* Reject reason */}
      {showReject && (
        <div className="mt-4 pt-4 border-t border-[var(--border-light)] space-y-3">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)"
            className="input w-full text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleReject()}
          />
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowReject(false)} className="bg-white/80 border border-slate-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-white transition-all">Cancel</button>
            <button
              onClick={handleReject}
              disabled={!!actionLoading}
              className="bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-rose-700 transition-all flex items-center gap-1.5"
            >
              {actionLoading === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ReviewQueue                                                        */
/* ------------------------------------------------------------------ */

export function ReviewQueue() {
  const { get, post } = useApi();
  const { projectId } = useProject();

  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<ReviewDecision[]>(`/api/projects/${projectId}/review-queue`);
      setDecisions(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message :
        (typeof err === 'object' && err !== null && 'message' in err)
          ? String((err as { message: unknown }).message)
          : 'Failed to load review queue.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  async function handleApprove(id: string) {
    await post(`/api/decisions/${id}/approve`, {});
    await fetchQueue();
  }

  async function handleReject(id: string, reason: string) {
    await post(`/api/decisions/${id}/reject`, { reason });
    await fetchQueue();
  }

  /* ---- Loading ---------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">Loading review queue…</span>
        </div>
      </div>
    );
  }

  /* ---- Error ------------------------------------------------------ */
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center">
          <AlertTriangle size={24} className="mx-auto mb-2 text-status-reverted" />
          <p className="text-sm text-status-reverted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Page Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">Review Queue</h1>
            <p className="text-[var(--text-secondary)] text-lg">
              {decisions.length} critical decision{decisions.length !== 1 ? 's' : ''} require human oversight
            </p>
          </div>
        </div>

        {/* Queue */}
        {decisions.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-xl bg-white/40 flex items-center justify-center mx-auto mb-4">
              <Inbox size={22} className="text-[var(--text-secondary)]" />
            </div>
            <p className="text-sm font-medium mb-1">No decisions pending review.</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Decisions extracted from conversations will appear here for review.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {decisions.map((d) => (
              <ReviewItem
                key={d.id}
                decision={d}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
