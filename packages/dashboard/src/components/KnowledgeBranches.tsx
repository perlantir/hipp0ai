import { useCallback, useEffect, useState } from 'react';
import {
  GitBranch,
  Plus,
  Loader2,
  X,
  GitMerge,
  Trash2,
  Check,
  FileDiff,
  Minus,
  CircleDot,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BranchStatus = 'open' | 'merged' | 'closed';
type MergeStrategy = 'all' | 'cherry_pick';

interface Branch {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  decision_count?: number;
  status: BranchStatus;
  created_at: string;
  merged_at?: string;
  is_main?: boolean;
}

interface DiffDecision {
  id: string;
  title: string;
  description?: string;
  status?: string;
}

interface BranchDiff {
  added: DiffDecision[];
  modified: DiffDecision[];
  removed: DiffDecision[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusColor(status: BranchStatus): { bg: string; text: string; border: string } {
  switch (status) {
    case 'open':
      return { bg: 'rgba(34,197,94,0.12)', text: '#22C55E', border: '#22C55E' };
    case 'merged':
      return { bg: 'rgba(139,92,246,0.12)', text: '#A78BFA', border: '#8B5CF6' };
    case 'closed':
      return { bg: 'rgba(107,114,128,0.12)', text: '#9CA3AF', border: '#6B7280' };
  }
}

function StatusBadge({ status }: { status: BranchStatus }) {
  const colors = statusColor(status);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}40`,
      }}
    >
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KnowledgeBranches() {
  const { get, post, del } = useApi();
  const { projectId } = useProject();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [mainBranch, setMainBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection + diff
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // New branch modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Merge modal
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('all');
  const [cherryPickIds, setCherryPickIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  /* ---- Fetch branches --------------------------------------------- */
  const fetchBranches = useCallback(async () => {
    if (!projectId || projectId === 'default') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await get<Branch[]>(`/api/projects/${projectId}/branches`);
      const list = Array.isArray(data) ? data : [];
      const main = list.find((b) => b.is_main || b.name === 'main') ?? null;
      setMainBranch(main);
      setBranches(list.filter((b) => !(b.is_main || b.name === 'main')));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to load branches');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  /* ---- Load diff -------------------------------------------------- */
  const loadDiff = useCallback(
    async (branchId: string) => {
      if (!projectId || projectId === 'default') return;
      setDiffLoading(true);
      setDiff(null);
      try {
        const data = await get<BranchDiff>(
          `/api/projects/${projectId}/branches/${branchId}/diff`,
        );
        setDiff({
          added: Array.isArray(data?.added) ? data.added : [],
          modified: Array.isArray(data?.modified) ? data.modified : [],
          removed: Array.isArray(data?.removed) ? data.removed : [],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to load diff');
        setError(msg);
      } finally {
        setDiffLoading(false);
      }
    },
    [get, projectId],
  );

  const handleSelectBranch = (id: string) => {
    setSelectedId(id);
    setCherryPickIds(new Set());
    loadDiff(id);
  };

  /* ---- Create branch ---------------------------------------------- */
  const handleCreateBranch = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await post<Branch>(`/api/projects/${projectId}/branches`, {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      setBranches((prev) => [created, ...prev]);
      setShowNewModal(false);
      setNewName('');
      setNewDescription('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to create branch');
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  /* ---- Merge branch ----------------------------------------------- */
  const handleMerge = async () => {
    if (!selectedId) return;
    setMerging(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { strategy: mergeStrategy };
      if (mergeStrategy === 'cherry_pick') {
        body.decision_ids = Array.from(cherryPickIds);
      }
      await post(`/api/projects/${projectId}/branches/${selectedId}/merge`, body);
      setShowMergeModal(false);
      setCherryPickIds(new Set());
      await fetchBranches();
      setSelectedId(null);
      setDiff(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to merge branch');
      setError(msg);
    } finally {
      setMerging(false);
    }
  };

  /* ---- Delete branch ---------------------------------------------- */
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this branch? This cannot be undone.')) return;
    setError(null);
    try {
      await del(`/api/projects/${projectId}/branches/${id}`);
      setBranches((prev) => prev.filter((b) => b.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDiff(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to delete branch');
      setError(msg);
    }
  };

  const selectedBranch = branches.find((b) => b.id === selectedId) ?? null;

  const toggleCherryPick = (decisionId: string) => {
    setCherryPickIds((prev) => {
      const next = new Set(prev);
      if (next.has(decisionId)) next.delete(decisionId);
      else next.add(decisionId);
      return next;
    });
  };

  /* ---- Render ------------------------------------------------------ */
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.15)' }}
          >
            <GitBranch className="w-5 h-5" style={{ color: '#A78BFA' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Decision Branches
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Fork your decision graph, experiment on a branch, and merge back the changes that work
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium"
        >
          <Plus size={16} /> New Branch
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-sm"
          style={{
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--accent-danger, #EF4444)',
            border: '1px solid rgba(239,68,68,0.4)',
          }}
        >
          {error}
        </div>
      )}

      {/* Main branch banner */}
      <div
        className="rounded-xl border p-4 mb-4 flex items-center gap-3"
        style={{
          background: 'var(--bg-card)',
          borderColor: '#D97706',
          borderWidth: 2,
        }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(217,119,6,0.2)' }}
        >
          <CircleDot size={16} style={{ color: '#D97706' }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              main
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                background: 'rgba(217,119,6,0.15)',
                color: '#D97706',
                border: '1px solid rgba(217,119,6,0.4)',
              }}
            >
              default
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
            {mainBranch?.decision_count ?? '—'} decisions in production
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div
          className="flex items-center justify-center py-16"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading branches...
        </div>
      )}

      {/* Content */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left: branch list */}
          <div className="lg:col-span-2 space-y-2">
            <h2
              className="text-xs font-semibold uppercase tracking-wide mb-2"
              style={{ color: 'var(--text-tertiary, #6B7280)' }}
            >
              Branches ({branches.length})
            </h2>
            {branches.length === 0 ? (
              <div
                className="rounded-xl border p-6 text-center"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: 'var(--border, #374151)',
                  borderStyle: 'dashed',
                }}
              >
                <GitBranch
                  className="w-8 h-8 mx-auto mb-2 opacity-30"
                  style={{ color: 'var(--text-tertiary, #6B7280)' }}
                />
                <p className="text-sm" style={{ color: 'var(--text-tertiary, #9CA3AF)' }}>
                  No branches yet. Create one to experiment with alternative decisions.
                </p>
              </div>
            ) : (
              branches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleSelectBranch(b.id)}
                  className="w-full text-left rounded-xl border p-4 transition-colors"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: selectedId === b.id ? '#D97706' : 'var(--border, #374151)',
                    borderWidth: selectedId === b.id ? 2 : 1,
                  }}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} style={{ color: '#A78BFA' }} />
                      <span
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {b.name}
                      </span>
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                  {b.description && (
                    <p
                      className="text-xs mb-2 line-clamp-2"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {b.description}
                    </p>
                  )}
                  <div
                    className="flex items-center gap-3 text-xs"
                    style={{ color: 'var(--text-tertiary, #6B7280)' }}
                  >
                    <span>{b.decision_count ?? 0} decisions</span>
                    <span>•</span>
                    <span>{new Date(b.created_at).toLocaleDateString()}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Right: diff view */}
          <div className="lg:col-span-3">
            {!selectedId && (
              <div
                className="rounded-xl border p-8 text-center h-full flex flex-col items-center justify-center"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: 'var(--border, #374151)',
                  borderStyle: 'dashed',
                }}
              >
                <FileDiff
                  className="w-12 h-12 mb-4 opacity-30"
                  style={{ color: 'var(--text-tertiary, #6B7280)' }}
                />
                <p
                  className="text-lg font-medium mb-2"
                  style={{ color: 'var(--text-tertiary, #9CA3AF)' }}
                >
                  Select a branch to see the diff
                </p>
                <p className="text-sm" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                  Compare the branch's decisions against main.
                </p>
              </div>
            )}

            {selectedBranch && (
              <div
                className="rounded-xl border p-4"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: 'var(--border, #374151)',
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <GitBranch size={16} style={{ color: '#A78BFA' }} />
                      <h2
                        className="text-lg font-bold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {selectedBranch.name}
                      </h2>
                      <span style={{ color: 'var(--text-tertiary, #6B7280)' }}>vs</span>
                      <span className="text-sm font-medium" style={{ color: '#D97706' }}>
                        main
                      </span>
                    </div>
                    {selectedBranch.description && (
                      <p className="text-xs" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                        {selectedBranch.description}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {selectedBranch.status === 'open' && (
                      <button
                        onClick={() => {
                          setShowMergeModal(true);
                          setMergeStrategy('all');
                          setCherryPickIds(new Set());
                        }}
                        className="flex items-center gap-1 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-3 py-1.5 text-xs font-medium"
                      >
                        <GitMerge size={14} /> Merge
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(selectedBranch.id)}
                      className="flex items-center gap-1 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-1.5 text-xs font-medium"
                      style={{ color: '#EF4444' }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>

                {diffLoading ? (
                  <div
                    className="flex items-center justify-center py-8"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading diff...
                  </div>
                ) : diff ? (
                  <div className="space-y-4">
                    {/* Added */}
                    <DiffSection
                      title="Added on branch"
                      decisions={diff.added}
                      color="#22C55E"
                      icon={<Plus size={14} />}
                    />

                    {/* Modified */}
                    <DiffSection
                      title="Modified"
                      decisions={diff.modified}
                      color="#EAB308"
                      icon={<FileDiff size={14} />}
                    />

                    {/* Removed */}
                    <DiffSection
                      title="Removed from main"
                      decisions={diff.removed}
                      color="#EF4444"
                      icon={<Minus size={14} />}
                    />

                    {diff.added.length === 0 &&
                      diff.modified.length === 0 &&
                      diff.removed.length === 0 && (
                        <p
                          className="text-sm text-center py-4"
                          style={{ color: 'var(--text-tertiary, #9CA3AF)' }}
                        >
                          No differences. This branch matches main exactly.
                        </p>
                      )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New branch modal */}
      {showNewModal && (
        <Modal onClose={() => setShowNewModal(false)} title="New Branch">
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Branch name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. experimental-search"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Description
              </label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                placeholder="What is this branch for?"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateBranch}
                disabled={creating || !newName.trim()}
                className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create
              </button>
              <button
                onClick={() => setShowNewModal(false)}
                className="border border-slate-300 hover:bg-slate-100 rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Merge modal */}
      {showMergeModal && selectedBranch && diff && (
        <Modal onClose={() => setShowMergeModal(false)} title={`Merge ${selectedBranch.name}`}>
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Choose how to merge this branch into main.
            </p>

            <div className="space-y-2">
              <label
                className="flex items-start gap-2 p-3 rounded-md cursor-pointer"
                style={{
                  background:
                    mergeStrategy === 'all' ? 'rgba(217,119,6,0.1)' : 'var(--bg-secondary, #1F2937)',
                  border: `1px solid ${mergeStrategy === 'all' ? '#D97706' : 'var(--border, #374151)'}`,
                }}
              >
                <input
                  type="radio"
                  name="strategy"
                  checked={mergeStrategy === 'all'}
                  onChange={() => setMergeStrategy('all')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Merge all changes
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary, #6B7280)' }}
                  >
                    Apply every change from this branch to main.
                  </div>
                </div>
              </label>

              <label
                className="flex items-start gap-2 p-3 rounded-md cursor-pointer"
                style={{
                  background:
                    mergeStrategy === 'cherry_pick'
                      ? 'rgba(217,119,6,0.1)'
                      : 'var(--bg-secondary, #1F2937)',
                  border: `1px solid ${
                    mergeStrategy === 'cherry_pick' ? '#D97706' : 'var(--border, #374151)'
                  }`,
                }}
              >
                <input
                  type="radio"
                  name="strategy"
                  checked={mergeStrategy === 'cherry_pick'}
                  onChange={() => setMergeStrategy('cherry_pick')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Cherry-pick
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary, #6B7280)' }}
                  >
                    Select individual decisions to merge.
                  </div>
                </div>
              </label>
            </div>

            {mergeStrategy === 'cherry_pick' && (
              <div
                className="max-h-64 overflow-y-auto rounded-md p-2 space-y-1"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  border: '1px solid var(--border, #374151)',
                }}
              >
                {[...diff.added, ...diff.modified].length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                    No decisions available to cherry-pick.
                  </p>
                ) : (
                  [...diff.added, ...diff.modified].map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={cherryPickIds.has(d.id)}
                        onChange={() => toggleCherryPick(d.id)}
                      />
                      <span
                        className="text-xs flex-1 truncate"
                        style={{ color: 'var(--text-primary)' }}
                        title={d.title}
                      >
                        {d.title}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleMerge}
                disabled={
                  merging ||
                  (mergeStrategy === 'cherry_pick' && cherryPickIds.size === 0)
                }
                className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {merging ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <GitMerge size={14} />
                )}
                Merge
              </button>
              <button
                onClick={() => setShowMergeModal(false)}
                className="border border-slate-300 hover:bg-slate-100 rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diff section                                                        */
/* ------------------------------------------------------------------ */

function DiffSection({
  title,
  decisions,
  color,
  icon,
}: {
  title: string;
  decisions: DiffDecision[];
  color: string;
  icon: React.ReactNode;
}) {
  if (decisions.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color }}>{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
          {title} ({decisions.length})
        </h3>
      </div>
      <div className="space-y-1.5">
        {decisions.map((d) => (
          <div
            key={d.id}
            className="rounded-md p-2 text-xs flex items-start gap-2"
            style={{
              background: `${color}10`,
              border: `1px solid ${color}40`,
            }}
          >
            <Check size={12} className="mt-0.5 shrink-0" style={{ color }} />
            <div className="flex-1 min-w-0">
              <div
                className="font-medium truncate"
                style={{ color: 'var(--text-primary)' }}
                title={d.title}
              >
                {d.title}
              </div>
              {d.description && (
                <div
                  className="truncate"
                  style={{ color: 'var(--text-tertiary, #6B7280)' }}
                  title={d.description}
                >
                  {d.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                               */
/* ------------------------------------------------------------------ */

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto"
        style={{
          background: 'var(--bg-card, #1F2937)',
          border: '1px solid var(--border, #374151)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default KnowledgeBranches;
