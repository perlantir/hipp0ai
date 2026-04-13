import { useEffect, useState, useCallback } from 'react';
import {
  Key,
  Loader2,
  X,
  Plus,
  Trash2,
  AlertTriangle,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentKey {
  id: string;
  project_id: string;
  agent_id: string | null;
  agent_name: string | null;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface AgentKeysListResponse {
  keys: AgentKey[];
}

interface CreatedKeyResponse {
  id: string;
  key: string;
  name: string;
  agent_id: string;
  project_id: string;
  scopes: string[];
  warning?: string;
}

interface AgentKeysModalProps {
  projectId: string;
  agentId: string;
  agentName: string;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Never';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AgentKeysModal({
  projectId,
  agentId,
  agentName,
  onClose,
}: AgentKeysModalProps) {
  const { get, post, del } = useApi();

  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedKeyResponse | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<AgentKeysListResponse>(
        `/api/projects/${projectId}/agents/${agentId}/keys`,
      );
      setKeys(Array.isArray(data?.keys) ? data.keys : []);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to load keys',
      );
    } finally {
      setLoading(false);
    }
  }, [get, projectId, agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await post<CreatedKeyResponse>(
        `/api/projects/${projectId}/agents/${agentId}/keys`,
        { name: newKeyName.trim() },
      );
      setCreatedKey(created);
      setNewKeyName('');
      // Reload the list so the new key appears.
      load();
    } catch (err) {
      setCreateError(
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to create key',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this key? Any agent using it will lose access immediately.')) return;
    setRevokingId(keyId);
    try {
      await del(
        `/api/projects/${projectId}/agents/${agentId}/keys/${keyId}`,
      );
      load();
    } catch (err) {
      alert(
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to revoke key',
      );
    } finally {
      setRevokingId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="rounded-xl border p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
              <Key size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                API Keys — {agentName}
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Per-agent credentials. Revoke individually without affecting
                the rest of the team.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Newly created key banner (shown once, raw key) */}
        {createdKey && (
          <div
            className="rounded-lg border p-4 mb-5"
            style={{
              backgroundColor: 'rgba(34, 197, 94, 0.08)',
              borderColor: 'rgba(34, 197, 94, 0.4)',
            }}
          >
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle size={16} className="text-yellow-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
                  Save this key now — it will not be shown again.
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {createdKey.warning ?? 'Store this key securely.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 font-mono text-xs px-3 py-2 rounded border overflow-x-auto"
                style={{
                  backgroundColor: 'var(--bg-card-hover)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                {createdKey.key}
              </code>
              <button
                onClick={() => copyToClipboard(createdKey.key)}
                className="p-2 rounded border transition-colors"
                style={{
                  backgroundColor: 'var(--bg-card-hover)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                title="Copy to clipboard"
              >
                {copied ? (
                  <CheckCircle2 size={14} className="text-green-400" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
            <button
              onClick={() => setCreatedKey(null)}
              className="mt-3 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create new key form */}
        <div
          className="rounded-lg border p-4 mb-5"
          style={{
            backgroundColor: 'var(--bg-card-hover)',
            borderColor: 'var(--border)',
          }}
        >
          <p className="text-xs font-semibold text-[var(--text-primary)] mb-2 uppercase tracking-wider">
            Create New Key
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. CI bot key, local dev"
              className="flex-1 px-3 py-2 rounded border text-sm"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
              disabled={creating}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newKeyName.trim()}
              className="px-4 py-2 rounded text-sm font-medium bg-primary text-white flex items-center gap-2 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Create
            </button>
          </div>
          {createError && (
            <p className="mt-2 text-xs text-red-400">{createError}</p>
          )}
        </div>

        {/* Existing keys */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={22} className="animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <AlertTriangle
              size={20}
              className="mx-auto mb-2 text-status-reverted"
            />
            <p className="text-sm text-status-reverted">{error}</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <p className="text-sm">No API keys yet.</p>
            <p className="text-xs mt-1">
              Create one above to give this agent its own credential.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 p-3 rounded-lg border"
                style={{
                  backgroundColor: 'var(--bg-card-hover)',
                  borderColor: 'var(--border)',
                  opacity: k.revoked_at ? 0.55 : 1,
                }}
              >
                <Key
                  size={14}
                  className={
                    k.revoked_at ? 'text-[var(--text-tertiary)]' : 'text-primary'
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {k.name}
                    {k.revoked_at && (
                      <span className="ml-2 text-2xs uppercase tracking-wider text-red-400">
                        revoked
                      </span>
                    )}
                  </p>
                  <p className="text-2xs text-[var(--text-tertiary)]">
                    Last used: {formatTimestamp(k.last_used_at)} · Created:{' '}
                    {formatTimestamp(k.created_at)}
                  </p>
                </div>
                {!k.revoked_at && (
                  <button
                    onClick={() => handleRevoke(k.id)}
                    disabled={revokingId === k.id}
                    className="p-2 rounded border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
                    style={{
                      borderColor: 'var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                    title="Revoke key"
                  >
                    {revokingId === k.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentKeysModal;
