import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
  Database,
  FolderOpen,
  Webhook,
  Search,
  CheckCircle2,
  XCircle,
  Activity,
  ChevronDown,
  ChevronUp,
  X,
  ToggleLeft,
  ToggleRight,
  GitBranch,
  ExternalLink,
  Link2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ConnectorType = 'openclaw' | 'directory' | 'webhook';

interface ConnectorConfig {
  path?: string;
  url?: string;
  secret?: string;
  interval_minutes?: number;
}

interface Connector {
  id: string;
  name: ConnectorType;
  config: ConnectorConfig;
  enabled: boolean;
  last_poll_at?: string;
  sources_processed: number;
  status: 'active' | 'error' | 'idle';
  error_message?: string;
}

interface DiscoveryStatus {
  running: boolean;
  last_run_at?: string;
  decisions_found: number;
  sources_scanned: number;
  next_run_at?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function connectorIcon(name: ConnectorType) {
  switch (name) {
    case 'openclaw':
      return <Search size={20} className="text-white" />;
    case 'directory':
      return <FolderOpen size={20} className="text-white" />;
    case 'webhook':
      return <Webhook size={20} className="text-white" />;
  }
}

function connectorLabel(name: ConnectorType) {
  switch (name) {
    case 'openclaw':
      return 'OpenClaw';
    case 'directory':
      return 'Directory';
    case 'webhook':
      return 'Webhook';
  }
}

function connectorBgColor(name: ConnectorType) {
  switch (name) {
    case 'openclaw':
      return '#ff2e93';
    case 'directory':
      return '#1A1D27';
    case 'webhook':
      return '#063ff9';
  }
}

function statusDot(status: Connector['status']) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[#063ff9]/10 text-[#063ff9]">
          <span className="w-2 h-2 bg-[#063ff9] rounded-full animate-pulse" />
          Connected
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-red-500/10 text-red-500">
          Error
        </span>
      );
    case 'idle':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[var(--text-secondary)]/10 text-[var(--text-secondary)]">
          Disconnected
        </span>
      );
  }
}

function relativeTime(iso?: string) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  ConnectorCard                                                      */
/* ------------------------------------------------------------------ */

interface ConnectorCardProps {
  connector: Connector;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

function ConnectorCard({ connector, onToggle, onDelete }: ConnectorCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="p-6 rounded-3xl animate-slide-up hover:-translate-y-1 transition-all duration-300"
      style={{
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.4)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
      }}
    >
      {/* Header row: icon + status badge */}
      <div className="flex justify-between items-start mb-6">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: connectorBgColor(connector.name) }}
        >
          {connectorIcon(connector.name)}
        </div>
        {statusDot(connector.status)}
      </div>

      {/* Title */}
      <h3 className="text-xl font-bold mb-4">{connectorLabel(connector.name)}</h3>

      {/* Config info */}
      <div className="space-y-4">
        {connector.config.path && (
          <div>
            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest block mb-1">Path</label>
            <input
              className="w-full bg-white/50 rounded-xl px-4 py-2 text-sm outline-none transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.6)' }}
              readOnly
              type="text"
              value={connector.config.path}
            />
          </div>
        )}
        {connector.config.url && (
          <div>
            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest block mb-1">URL</label>
            <input
              className="w-full bg-white/50 rounded-xl px-4 py-2 text-sm outline-none transition-all font-mono"
              style={{ border: '1px solid rgba(255,255,255,0.6)' }}
              readOnly
              type="text"
              value={connector.config.url}
            />
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span>Last poll: <strong className="text-[var(--text-primary)]">{relativeTime(connector.last_poll_at)}</strong></span>
          <span>Sources: <strong className="text-[var(--text-primary)]">{connector.sources_processed}</strong></span>
          {connector.config.interval_minutes && (
            <span>Interval: <strong className="text-[var(--text-primary)]">{connector.config.interval_minutes}m</strong></span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggle(connector.id, !connector.enabled)}
            className="flex-1 py-2.5 text-sm font-bold rounded-xl transition-all"
            style={{
              ...(connector.enabled
                ? { border: '1px solid rgba(6,63,249,0.2)', color: '#063ff9', background: 'transparent' }
                : { background: '#063ff9', color: 'white', border: 'none', boxShadow: '0 0 20px rgba(6,63,249,0.2)' }),
            }}
          >
            {connector.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-2.5 rounded-xl transition-all hover:bg-black/5"
            style={{ border: '1px solid rgba(6,63,249,0.2)' }}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={() => onDelete(connector.id)}
            className="p-2.5 rounded-xl transition-all hover:bg-red-50 hover:text-red-500"
            style={{ border: '1px solid rgba(6,63,249,0.2)' }}
            title="Remove connector"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-6 pt-6 space-y-3" style={{ borderTop: '1px solid var(--border-light)' }}>
          {/* Mobile stats */}
          <div className="flex items-center gap-6 sm:hidden">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Last poll</p>
              <p className="text-xs font-medium">{relativeTime(connector.last_poll_at)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Sources processed</p>
              <p className="text-xs font-medium">{connector.sources_processed}</p>
            </div>
          </div>

          {/* Error */}
          {connector.status === 'error' && connector.error_message && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
              <p className="text-xs text-red-600">{connector.error_message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add connector form                                                 */
/* ------------------------------------------------------------------ */

const CONNECTOR_TYPES: ConnectorType[] = ['openclaw', 'directory', 'webhook'];

interface AddConnectorFormProps {
  onAdd: (connector: { name: ConnectorType; config: ConnectorConfig }) => Promise<void>;
  onCancel: () => void;
}

function AddConnectorForm({ onAdd, onCancel }: AddConnectorFormProps) {
  const [type, setType] = useState<ConnectorType>('openclaw');
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [interval, setInterval] = useState('30');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const config: ConnectorConfig = {};
    if (type === 'openclaw' || type === 'directory') {
      if (!path.trim()) {
        setError('Path is required.');
        return;
      }
      config.path = path.trim();
    } else {
      if (!url.trim()) {
        setError('Webhook URL is required.');
        return;
      }
      config.url = url.trim();
      if (secret.trim()) config.secret = secret.trim();
    }

    const parsed = parseInt(interval);
    if (!isNaN(parsed) && parsed > 0) config.interval_minutes = parsed;

    setLoading(true);
    try {
      await onAdd({ name: type, config });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to add connector.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-6 rounded-3xl animate-slide-up"
      style={{
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.4)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
      }}
    >
      <h3 className="text-xl font-bold mb-6">New Connector</h3>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 mb-4" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Type */}
        <div>
          <label className="block text-[10px] font-bold mb-1 uppercase tracking-widest text-[var(--text-secondary)]">
            Connector type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ConnectorType)}
            className="w-full bg-white/50 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-[#063ff9]/20"
            style={{ border: '1px solid rgba(255,255,255,0.6)' }}
          >
            {CONNECTOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {connectorLabel(t)}
              </option>
            ))}
          </select>
        </div>

        {/* Path */}
        {(type === 'openclaw' || type === 'directory') && (
          <div>
            <label className="block text-[10px] font-bold mb-1 uppercase tracking-widest text-[var(--text-secondary)]">
              {type === 'openclaw' ? 'OpenClaw path' : 'Directory path'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={type === 'openclaw' ? '/path/to/openclaw' : '/projects/myapp'}
              className="w-full bg-white/50 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-[#063ff9]/20"
              style={{ border: '1px solid rgba(255,255,255,0.6)' }}
              autoFocus
            />
          </div>
        )}

        {/* Webhook URL */}
        {type === 'webhook' && (
          <>
            <div>
              <label className="block text-[10px] font-bold mb-1 uppercase tracking-widest text-[var(--text-secondary)]">
                Webhook URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.example.com/..."
                className="w-full bg-white/50 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-[#063ff9]/20"
                style={{ border: '1px solid rgba(255,255,255,0.6)' }}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1 uppercase tracking-widest text-[var(--text-secondary)]">
                Secret <span className="opacity-50">(optional)</span>
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Signing secret"
                className="w-full bg-white/50 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-[#063ff9]/20"
                style={{ border: '1px solid rgba(255,255,255,0.6)' }}
              />
            </div>
          </>
        )}

        {/* Poll interval */}
        {type !== 'webhook' && (
          <div>
            <label className="block text-[10px] font-bold mb-1 uppercase tracking-widest text-[var(--text-secondary)]">
              Poll interval (minutes)
            </label>
            <input
              type="number"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              min="1"
              max="1440"
              className="w-32 bg-white/50 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-[#063ff9]/20"
              style={{ border: '1px solid rgba(255,255,255,0.6)' }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 justify-end mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:bg-black/5"
          style={{ border: '1px solid rgba(6,63,249,0.2)', color: 'var(--text-primary)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 bg-[#063ff9] text-white text-sm font-bold rounded-xl shadow-[0_0_20px_rgba(6,63,249,0.2)] hover:shadow-[0_0_20px_rgba(6,63,249,0.4)] transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add connector
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  GitHub Integration Settings                                        */
/* ------------------------------------------------------------------ */

interface GitHubStatus {
  connected: boolean;
  app_id: string | null;
  installation_id: string | null;
  total_links: number;
  open_pr_links: number;
  merged_pr_links: number;
}

function GitHubSettings({ projectId }: { projectId: string }) {
  const { get } = useApi();
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prComments, setPrComments] = useState(true);
  const [autoExtract, setAutoExtract] = useState(true);
  const [supersedeNotify, setSupersedeNotify] = useState(true);
  const [autoLink, setAutoLink] = useState(true);

  const testConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<GitHubStatus>(`/api/projects/${projectId}/github/status`);
      setStatus(data);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to check GitHub status.');
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => {
    testConnection();
  }, [testConnection]);

  return (
    <div
      className="p-6 rounded-3xl hover:-translate-y-1 transition-all duration-300"
      style={{
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.4)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex justify-between items-start mb-6">
        <div className="w-12 h-12 bg-[#1A1D27] rounded-2xl flex items-center justify-center">
          <GitBranch size={20} className="text-white" />
        </div>
        {status?.connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[#063ff9]/10 text-[#063ff9]">
            <span className="w-2 h-2 bg-[#063ff9] rounded-full animate-pulse" />
            Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-[var(--text-secondary)]/10 text-[var(--text-secondary)]">
            Not configured
          </span>
        )}
      </div>

      <h3 className="text-xl font-bold mb-4">GitHub</h3>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 mb-4" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {status && (
        <>
          {/* Connection details */}
          <div className="space-y-4 mb-4">
            {status.app_id && (
              <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest block mb-1">App ID</label>
                <input
                  className="w-full bg-white/50 rounded-xl px-4 py-2 text-sm outline-none"
                  style={{ border: '1px solid rgba(255,255,255,0.6)' }}
                  readOnly
                  value={status.app_id}
                />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5">Total links</p>
                <p className="text-sm font-bold">{status.total_links}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5">Open PRs</p>
                <p className="text-sm font-bold">{status.open_pr_links}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5">Merged PRs</p>
                <p className="text-sm font-bold">{status.merged_pr_links}</p>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2.5 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Options</p>
            {[
              { label: 'Post relevant decisions on new PRs', value: prComments, set: setPrComments },
              { label: 'Auto-extract decisions from merged PRs', value: autoExtract, set: setAutoExtract },
              { label: 'Notify PRs when decisions are superseded', value: supersedeNotify, set: setSupersedeNotify },
              { label: 'Auto-link PRs that reference decisions', value: autoLink, set: setAutoLink },
            ].map((opt) => (
              <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={opt.value}
                  onChange={(e) => opt.set(e.target.checked)}
                  className="w-5 h-5 rounded text-[#063ff9] border-gray-300 focus:ring-[#063ff9]"
                />
                <span className="text-sm font-medium text-[var(--text-secondary)]">{opt.label}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <button
        onClick={testConnection}
        disabled={loading}
        className="w-full py-2.5 text-sm font-bold rounded-xl transition-all"
        style={{ border: '1px solid rgba(6,63,249,0.2)', color: '#063ff9' }}
      >
        {loading ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : <RefreshCw size={14} className="inline mr-1.5" />}
        Manage Sync Settings
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Connectors page                                                    */
/* ------------------------------------------------------------------ */

/*  Linear Settings Panel                                              */
/* ------------------------------------------------------------------ */

interface LinearStatus {
  connected: boolean;
  team_id: string | null;
  team_name: string | null;
  auto_create: boolean;
  auto_create_all: boolean;
  auto_validate: boolean;
  notify_on_cancel: boolean;
  trigger_tags: string[];
  connected_at: string | null;
}

function LinearSettingsPanel({ projectId }: { projectId: string }) {
  const { get, post } = useApi();
  const [status, setStatus] = useState<LinearStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<LinearStatus>(`/api/linear/status/${projectId}`);
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Check for OAuth callback token in URL
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/linear_token=([^&]+)/);
    if (match) {
      // Clean up URL
      window.location.hash = '#connectors';
    }
  }, []);

  async function handleDisconnect() {
    setSaving(true);
    try {
      await post('/api/linear/disconnect', { project_id: projectId });
      await fetchStatus();
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function handleToggleSetting(key: string, value: boolean) {
    if (!status) return;
    setSaving(true);
    try {
      await post('/api/linear/connect', {
        project_id: projectId,
        access_token: '_existing_',
        team_id: status.team_id,
        team_name: status.team_name,
        auto_create: key === 'auto_create' ? value : status.auto_create,
        auto_create_all: key === 'auto_create_all' ? value : status.auto_create_all,
        auto_validate: key === 'auto_validate' ? value : status.auto_validate,
        notify_on_cancel: key === 'notify_on_cancel' ? value : status.notify_on_cancel,
        trigger_tags: status.trigger_tags,
      });
      await fetchStatus();
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div
        className="p-6 rounded-3xl"
        style={{
          background: 'rgba(255,255,255,0.6)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.4)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
        }}
      >
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-[#063ff9]" />
          <span className="text-sm text-[var(--text-secondary)]">Loading Linear status...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-6 rounded-3xl hover:-translate-y-1 transition-all duration-300"
      style={{
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.4)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex justify-between items-start mb-6">
        <div className="w-12 h-12 rounded-2xl bg-[#5E6AD2] flex items-center justify-center shrink-0">
          <svg width="20" height="20" viewBox="0 0 100 100" fill="none">
            <path d="M1.22541 61.5228c-.97401-6.5599-.62806-13.2361.95743-19.6243l57.919 57.9191c-6.3882 1.5855-13.0644 1.9315-19.6243.9574L1.22541 61.5228zM.00241111 46.8891c-.09505 1.1294-.15484 2.2628-.17908 3.3996L43.6813 93.1466c1.2981-.0285 2.5935-.1008 3.8833-.217L.00241111 46.8891zM.25025 40.8372c-.10912 1.1003-.18579 2.2043-.22972 3.3118L40.948 93.0771c1.0878-.0415 2.1728-.1155 3.2543-.2213L.25025 40.8372z" fill="#FFFFFF"/>
            <path d="M92.8746 37.5765 37.5764 92.8747c-6.4289-2.6921-12.2583-6.7755-17.0422-11.5595l71.3002-71.3004c4.784 4.7839 8.8674 10.6133 11.5595 17.0422l-10.5193 10.5195z" fill="#FFFFFF"/>
            <path d="M96.6356 46.8891c.095 1.1294.1548 2.2628.1791 3.3996L53.9569 93.1466c-1.2981-.0285-2.5935-.1008-3.8833-.217l46.5620-46.0405zM96.7875 40.8372c.1091 1.1003.1858 2.2043.2297 3.3118L50.0893 93.0771c-1.0878-.0415-2.1728-.1155-3.2543-.2213l49.9525-52.0186z" fill="#FFFFFF"/>
          </svg>
        </div>
        {status?.connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[#063ff9]/10 text-[#063ff9]">
            <span className="w-2 h-2 bg-[#063ff9] rounded-full animate-pulse" />
            Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[var(--text-secondary)]/10 text-[var(--text-secondary)]">
            Not connected
          </span>
        )}
      </div>

      <h3 className="text-xl font-bold mb-4">Linear</h3>

      {status?.connected ? (
        <div className="space-y-4">
          {/* Team info */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-secondary)]">Team:</span>
            <span className="font-bold">{status.team_name || status.team_id}</span>
          </div>

          {/* Settings toggles */}
          <div className="space-y-3 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
            {[
              { key: 'auto_create', label: 'Auto-create issues for action-required decisions', value: status.auto_create },
              { key: 'auto_create_all', label: 'Auto-create issues for ALL decisions', value: status.auto_create_all },
              { key: 'auto_validate', label: 'Auto-validate decisions when issue is completed', value: status.auto_validate },
              { key: 'notify_on_cancel', label: 'Notify when Linear issue is cancelled', value: status.notify_on_cancel },
            ].map((setting) => (
              <div key={setting.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--text-secondary)]">{setting.label}</span>
                <button
                  onClick={() => handleToggleSetting(setting.key, !setting.value)}
                  disabled={saving}
                  className="shrink-0"
                >
                  {setting.value ? (
                    <ToggleRight size={24} className="text-primary" />
                  ) : (
                    <ToggleLeft size={24} className="text-[var(--text-secondary)]" />
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Trigger tags */}
          <div className="pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-2">Auto-create trigger tags</p>
            <div className="flex flex-wrap gap-1.5">
              {status.trigger_tags.map((tag) => (
                <span key={tag} className="tag-pill text-xs">{tag}</span>
              ))}
            </div>
          </div>

          {/* Disconnect */}
          <div className="pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
            <button
              onClick={handleDisconnect}
              disabled={saving}
              className="w-full py-2.5 text-sm font-bold rounded-xl transition-all text-red-500 hover:bg-red-50"
              style={{ border: '1px solid rgba(239,68,68,0.2)' }}
            >
              {saving ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : <X size={14} className="inline mr-1.5" />}
              Disconnect Linear
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Connect Linear to auto-create issues from decisions and sync issue status.
          </p>
          <a
            href="/api/linear/install"
            className="w-full py-2.5 bg-[#063ff9] text-white text-sm font-bold rounded-xl shadow-[0_0_20px_rgba(6,63,249,0.2)] hover:shadow-[0_0_20px_rgba(6,63,249,0.4)] transition-all inline-flex items-center justify-center gap-2"
          >
            <ExternalLink size={14} />
            Connect Linear
          </a>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Linked Issues Section (for use in decision detail)                 */
/* ------------------------------------------------------------------ */

interface DecisionLink {
  id: string;
  platform: string;
  external_id: string;
  external_url: string;
  link_type: string;
  status: string;
  title: string;
  created_at: string;
}

export function LinkedIssues({ decisionId }: { decisionId: string }) {
  const { get, post } = useApi();
  const [links, setLinks] = useState<DecisionLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkId, setLinkId] = useState('');

  const fetchLinks = useCallback(async () => {
    try {
      const data = await get<DecisionLink[]>(`/api/decisions/${decisionId}/links`);
      setLinks(Array.isArray(data) ? data : []);
    } catch { setLinks([]); }
    finally { setLoading(false); }
  }, [get, decisionId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  async function handleManualLink() {
    if (!linkId.trim()) return;
    try {
      await post(`/api/decisions/${decisionId}/links`, {
        platform: 'linear',
        external_id: linkId.trim(),
        link_type: 'implements',
      });
      setLinkId('');
      setShowLinkForm(false);
      fetchLinks();
    } catch { /* silent */ }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={13} className="text-green-500" />;
      case 'cancelled': return <XCircle size={13} className="text-red-400" />;
      default: return <Clock size={13} className="text-[#063ff9]" />;
    }
  };

  if (loading) return null;

  const linearLinks = links.filter((l) => l.platform === 'linear');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Link2 size={12} />
          Linked Issues
        </h4>
        <button
          onClick={() => setShowLinkForm((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          Link Issue
        </button>
      </div>

      {showLinkForm && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            placeholder="e.g. ENG-123"
            className="input text-xs flex-1"
            onKeyDown={(e) => e.key === 'Enter' && handleManualLink()}
          />
          <button onClick={handleManualLink} className="btn-primary text-xs px-3 py-1.5">
            Link
          </button>
        </div>
      )}

      {linearLinks.length === 0 && !showLinkForm ? (
        <p className="text-xs text-[var(--text-tertiary)]">No linked issues.</p>
      ) : (
        <div className="space-y-1.5">
          {linearLinks.map((link) => (
            <div key={link.id} className="flex items-center gap-2 text-sm">
              {statusIcon(link.status)}
              <span className="font-mono text-xs text-primary">{link.external_id}</span>
              {link.title && <span className="text-xs truncate flex-1">{link.title}</span>}
              <span className="text-2xs text-[var(--text-tertiary)] capitalize">{link.status}</span>
              {link.external_url && (
                <a href={link.external_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function Connectors() {
  const { get, post, patch, del } = useApi();
  const { projectId } = useProject();

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  /* ---- Fetch ---------------------------------------------------- */

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectorsRes, statusRes] = await Promise.allSettled([
        get<Connector[]>(`/api/projects/${projectId}/connectors`),
        get<DiscoveryStatus>(`/api/projects/${projectId}/discovery/status`),
      ]);
      if (connectorsRes.status === 'fulfilled') setConnectors(Array.isArray(connectorsRes.value) ? connectorsRes.value : []);
      if (statusRes.status === 'fulfilled') setDiscovery(statusRes.value);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message :
        (typeof err === 'object' && err !== null && 'message' in err)
          ? String((err as {message: unknown}).message)
          : 'Failed to load connectors.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ---- Actions -------------------------------------------------- */

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await patch(`/api/projects/${projectId}/connectors/${id}`, { enabled });
      setConnectors((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
    } catch {
      // silent — refresh will sync
    }
  }

  async function handleDelete(id: string) {
    try {
      await del(`/api/projects/${projectId}/connectors/${id}`);
      setConnectors((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silent
    }
  }

  async function handleAdd({
    name,
    config,
  }: {
    name: ConnectorType;
    config: ConnectorConfig;
  }) {
    const created = await post<Connector>(`/api/projects/${projectId}/connectors`, {
      name,
      config,
      enabled: true,
    });
    setConnectors((prev) => [...prev, created]);
    setShowForm(false);
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={28} className="animate-spin text-[#063ff9]" />
          <span className="text-sm text-[var(--text-secondary)]">Loading connectors...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-12 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-4xl font-bold tracking-tight">Connectors &amp; Integrations</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchAll}
                className="px-5 py-2 rounded-xl text-sm font-bold transition-all hover:bg-black/5"
                style={{ border: '1px solid rgba(6,63,249,0.2)' }}
                title="Refresh"
              >
                <RefreshCw size={14} className="inline mr-1.5" />
                Refresh
              </button>
              <button
                onClick={() => setShowForm((v) => !v)}
                className="px-5 py-2 bg-[#063ff9] text-white rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(6,63,249,0.4)] hover:-translate-y-0.5 active:scale-95 transition-all flex items-center gap-1.5"
              >
                <Plus size={15} />
                Add connector
              </button>
            </div>
          </div>
          <p className="text-[var(--text-secondary)] text-lg">Extend the swarm intelligence by bridging HIPP0 with your existing workflow stacks.</p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-4 rounded-xl bg-red-500/10 mb-8" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={fetchAll} className="ml-auto shrink-0 text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
              <RefreshCw size={11} />
              Retry
            </button>
          </div>
        )}

        {/* Discovery status banner */}
        {discovery && (
          <div
            className="p-6 mb-8 rounded-3xl"
            style={{
              background: 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.4)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Activity size={18} className="text-[#063ff9]" />
              <h3 className="text-lg font-bold">Discovery Status</h3>
              {discovery.running ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-green-500/15 text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Running
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-[var(--text-secondary)]/10 text-[var(--text-secondary)]">
                  Idle
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {[
                {
                  icon: <Database size={14} />,
                  label: 'Decisions found',
                  value: discovery.decisions_found,
                },
                {
                  icon: <FolderOpen size={14} />,
                  label: 'Sources scanned',
                  value: discovery.sources_scanned,
                },
                {
                  icon: <Clock size={14} />,
                  label: 'Last run',
                  value: relativeTime(discovery.last_run_at),
                },
                {
                  icon: <Clock size={14} />,
                  label: 'Next run',
                  value: relativeTime(discovery.next_run_at),
                },
              ].map((item, i) => (
                <div key={i}>
                  <div className="flex items-center gap-1.5 text-[var(--text-secondary)] mb-1">
                    {item.icon}
                    <span className="text-xs font-bold uppercase tracking-widest">{item.label}</span>
                  </div>
                  <p className="text-lg font-bold">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add form */}
        {showForm && (
          <div className="mb-8">
            <AddConnectorForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Integration Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* GitHub integration */}
          <GitHubSettings projectId={projectId} />

          {/* Linear Integration */}
          <LinearSettingsPanel projectId={projectId} />

          {/* Connector cards */}
          {(connectors ?? []).length === 0 ? (
            <div
              className="p-8 rounded-3xl flex flex-col items-center justify-center text-center md:col-span-2 lg:col-span-1 hover:-translate-y-1 transition-all duration-300"
              style={{
                background: 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(24px)',
                border: '2px dashed rgba(6,63,249,0.2)',
                boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
              }}
            >
              <div className="w-16 h-16 rounded-full bg-[#063ff9]/5 flex items-center justify-center mx-auto mb-4">
                <Database size={28} className="text-[#063ff9]" />
              </div>
              <p className="text-lg font-bold mb-2">No connectors configured</p>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Add a connector to start auto-discovering decisions.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="px-6 py-2.5 bg-[#063ff9] text-white text-sm font-bold rounded-xl shadow-[0_0_20px_rgba(6,63,249,0.2)] hover:shadow-[0_0_20px_rgba(6,63,249,0.4)] transition-all flex items-center gap-2"
              >
                <Plus size={15} />
                Add your first connector
              </button>
            </div>
          ) : (
            <>
              {(connectors ?? []).map((c) => (
                <ConnectorCard
                  key={c.id}
                  connector={c}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
