import { useEffect, useState, useCallback } from 'react';
import {
  GitPullRequest,
  ExternalLink,
  Plus,
  X,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DecisionLink {
  id: string;
  decision_id: string;
  project_id: string;
  platform: string;
  external_id: string;
  external_url?: string;
  link_type: string;
  title?: string;
  status: string;
  author?: string;
  linked_by: string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusIcon(status: string) {
  switch (status) {
    case 'merged':
      return <span title="Merged" className="text-purple-500">&#10003;</span>;
    case 'open':
      return <span title="Open" className="w-2 h-2 inline-block rounded-full bg-green-400" />;
    case 'closed':
      return <span title="Closed" className="w-2 h-2 inline-block rounded-full bg-red-400" />;
    default:
      return <span title={status} className="w-2 h-2 inline-block rounded-full bg-gray-400" />;
  }
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function linkTypeBadge(type: string) {
  const colors: Record<string, string> = {
    implements: 'bg-green-100 text-green-800',
    references: 'bg-blue-100 text-blue-800',
    created_by: 'bg-purple-100 text-purple-800',
    validates: 'bg-blue-100 text-blue-800',
    affects: 'bg-blue-100 text-blue-800',
  };
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${colors[type] ?? 'bg-gray-100 text-gray-700'}`}>
      {type}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Manual link form                                                   */
/* ------------------------------------------------------------------ */

function ManualLinkForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: {
    platform: string;
    external_id: string;
    external_url: string;
    link_type: string;
    title: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = useState('github');
  const [externalId, setExternalId] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [linkType, setLinkType] = useState('references');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit({ platform, external_id: externalId, external_url: externalUrl, link_type: linkType, title });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 rounded-lg border border-[var(--border-light)] bg-[var(--bg-primary)]">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="input w-full text-xs">
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="jira">Jira</option>
            <option value="linear">Linear</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Link type</label>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)} className="input w-full text-xs">
            <option value="implements">Implements</option>
            <option value="references">References</option>
            <option value="created_by">Created by</option>
            <option value="validates">Validates</option>
            <option value="affects">Affects</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">External ID <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder="owner/repo#47"
            className="input w-full text-xs"
            required
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">URL</label>
          <input
            type="url"
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://github.com/..."
            className="input w-full text-xs"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PR title or issue name"
            className="input w-full text-xs"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1 px-2">Cancel</button>
        <button type="submit" disabled={loading || !externalId.trim()} className="btn-primary text-xs py-1 px-2 flex items-center gap-1">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Link
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  LinkedPRs section                                                  */
/* ------------------------------------------------------------------ */

export function LinkedPRs({ decisionId }: { decisionId: string }) {
  const { get, post, del } = useApi();
  const [links, setLinks] = useState<DecisionLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<DecisionLink[]>(`/api/decisions/${decisionId}/links`);
      setLinks(Array.isArray(data) ? data : []);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [get, decisionId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  async function handleAdd(data: {
    platform: string;
    external_id: string;
    external_url: string;
    link_type: string;
    title: string;
  }) {
    const created = await post<DecisionLink>(`/api/decisions/${decisionId}/links`, data);
    setLinks((prev) => [created, ...prev]);
    setShowForm(false);
  }

  async function handleDelete(linkId: string) {
    await del(`/api/links/${linkId}`);
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 size={14} className="animate-spin text-[var(--text-secondary)]" />
        <span className="text-xs text-[var(--text-secondary)]">Loading links...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <GitPullRequest size={14} className="text-primary" />
          <label className="text-xs text-[var(--text-secondary)]">Linked Pull Requests</label>
          {links.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {links.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
        >
          <Plus size={11} />
          Link PR
        </button>
      </div>

      {showForm && (
        <ManualLinkForm onSubmit={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {links.length === 0 && !showForm ? (
        <p className="text-xs text-[var(--text-secondary)] py-1">No linked PRs yet.</p>
      ) : (
        <div className="space-y-1.5">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-start gap-2 p-2 rounded-md border border-[var(--border-light)] bg-[var(--bg-primary)] text-xs"
            >
              <div className="mt-0.5 shrink-0">{statusIcon(link.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium truncate">{link.external_id}</span>
                  {linkTypeBadge(link.link_type)}
                </div>
                {link.title && (
                  <p className="text-[var(--text-secondary)] truncate mt-0.5">{link.title}</p>
                )}
                <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                  {relativeTime(link.created_at)}
                  {link.author && <> by {link.author}</>}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {link.external_url && (
                  <a
                    href={link.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost p-1 hover:text-primary transition-colors"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                <button
                  onClick={() => handleDelete(link.id)}
                  className="btn-ghost p-1 hover:text-red-400 transition-colors"
                  title="Remove link"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
