/**
 * HermesSetup view — bridge between the HIPP0 dashboard and a Hermes
 * runtime that wants to register itself as a persistent-multi-agent
 * Hipp0MemoryProvider.
 *
 * Shows exactly the values a user needs to wire up Hermes:
 *   - HIPP0 base URL (from env or window.location)
 *   - API key status (configured vs dev-mode)
 *   - Current project_id
 *   - Live connection test against /api/health
 *   - Copy-pasteable environment block for the Hermes runtime
 *   - Copy-pasteable curl command to register a test agent
 *
 * This is the single screen we point people at when they ask "how do
 * I connect a Hermes instance to this dashboard?"
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Settings as SettingsIcon,
  Check,
  X,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Terminal,
  Key,
  Globe,
  Folder,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.replace(/\/$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

function getApiKeyStatus(): { present: boolean; masked: string } {
  try {
    const key = typeof window !== 'undefined' ? window.localStorage.getItem('hipp0_api_key') : null;
    if (key && key.trim().length > 0) {
      const masked = `${key.slice(0, 8)}…${key.slice(-4)}`;
      return { present: true, masked };
    }
  } catch {
    /* storage unavailable */
  }
  return { present: false, masked: '(not set — dev mode)' };
}

/* ------------------------------------------------------------------ */
/*  CopyButton                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [text]);
  return (
    <button
      onClick={onClick}
      title={label ?? 'Copy'}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md hover:bg-[var(--bg-hover)] transition-colors"
      style={{ color: 'var(--text-secondary)' }}
    >
      {copied ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function HermesSetup() {
  const { get } = useApi();
  const { projectId } = useProject();

  const baseUrl = getBaseUrl();
  const keyStatus = getApiKeyStatus();
  const isValidProject = UUID_RE.test(projectId);

  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setHealthError(null);
    setHealthOk(null);
    try {
      // /api/health is unauthenticated in the server app
      await get<{ status: string }>('/api/health');
      setHealthOk(true);
    } catch (err: unknown) {
      setHealthOk(false);
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Connection failed';
      setHealthError(msg);
    } finally {
      setTesting(false);
    }
  }, [get]);

  useEffect(() => {
    testConnection();
  }, [testConnection]);

  // Build the copy-pasteable environment block
  const envBlock = [
    `HIPP0_BASE_URL=${baseUrl}`,
    `HIPP0_API_KEY=${keyStatus.present ? '<your-key>' : '# not required in dev mode'}`,
    `HIPP0_PROJECT_ID=${isValidProject ? projectId : '<your-project-uuid>'}`,
  ].join('\n');

  // Build a test curl command that registers alice
  const curlRegister = [
    `curl -X POST ${baseUrl}/api/hermes/register \\`,
    `  -H 'Content-Type: application/json' \\`,
    keyStatus.present ? `  -H 'Authorization: Bearer <your-key>' \\` : null,
    `  -d '{`,
    `    "project_id": "${isValidProject ? projectId : '<your-project-uuid>'}",`,
    `    "agent_name": "alice",`,
    `    "soul": "# Alice\\nYou are alice, a sales agent.",`,
    `    "config": { "model": "anthropic/claude-sonnet-4-6", "toolset": "sales" }`,
    `  }'`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <SettingsIcon size={18} className="text-primary" />
            Hermes Setup
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Connection details and test commands for wiring a Hermes runtime to this HIPP0 instance.
          </p>
        </div>

        {/* Connection status card */}
        <div className="card p-5" style={{ backgroundColor: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Connection
            </div>
            <button
              onClick={testConnection}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-secondary)' }}
              disabled={testing}
              title="Test connection"
            >
              {testing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Test
            </button>
          </div>

          <dl className="text-xs space-y-3">
            {/* Base URL */}
            <div className="flex items-center gap-3">
              <dt className="w-32 text-[var(--text-secondary)] flex items-center gap-1.5 shrink-0">
                <Globe size={12} />
                Base URL
              </dt>
              <dd className="flex-1 font-mono truncate">{baseUrl}</dd>
              <CopyButton text={baseUrl} />
            </div>

            {/* API key */}
            <div className="flex items-center gap-3">
              <dt className="w-32 text-[var(--text-secondary)] flex items-center gap-1.5 shrink-0">
                <Key size={12} />
                API Key
              </dt>
              <dd className="flex-1 font-mono truncate">{keyStatus.masked}</dd>
              <div className="text-[10px] font-semibold uppercase">
                {keyStatus.present ? (
                  <span className="text-green-500">set</span>
                ) : (
                  <span className="text-[var(--text-secondary)]">dev</span>
                )}
              </div>
            </div>

            {/* Project ID */}
            <div className="flex items-center gap-3">
              <dt className="w-32 text-[var(--text-secondary)] flex items-center gap-1.5 shrink-0">
                <Folder size={12} />
                Project ID
              </dt>
              <dd className="flex-1 font-mono truncate">
                {isValidProject ? projectId : '(select a project)'}
              </dd>
              {isValidProject && <CopyButton text={projectId} />}
            </div>

            {/* Health status */}
            <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-color,rgba(255,255,255,0.08))]">
              <dt className="w-32 text-[var(--text-secondary)] shrink-0">Health</dt>
              <dd className="flex-1 flex items-center gap-2">
                {testing && <Loader2 size={14} className="animate-spin text-primary" />}
                {!testing && healthOk === true && (
                  <>
                    <Check size={14} className="text-green-500" />
                    <span className="text-green-500 font-medium">Reachable</span>
                  </>
                )}
                {!testing && healthOk === false && (
                  <>
                    <X size={14} className="text-status-reverted" />
                    <span className="text-status-reverted font-medium">
                      Unreachable
                      {healthError ? ` — ${healthError}` : ''}
                    </span>
                  </>
                )}
                {!testing && healthOk === null && (
                  <span className="text-[var(--text-secondary)]">—</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Environment block */}
        <div className="card p-5" style={{ backgroundColor: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Hermes environment
            </div>
            <CopyButton text={envBlock} label="Copy env block" />
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            Drop these into your Hermes runtime's env file. The Hipp0MemoryProvider reads them on startup.
          </p>
          <pre
            className="text-xs font-mono p-3 rounded-md overflow-x-auto whitespace-pre"
            style={{
              backgroundColor: 'var(--bg-code, rgba(0,0,0,0.2))',
            }}
          >
            {envBlock}
          </pre>
          {!isValidProject && (
            <div className="mt-2 text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-yellow-500" />
              Select a project above to fill in HIPP0_PROJECT_ID automatically.
            </div>
          )}
        </div>

        {/* Test curl */}
        <div className="card p-5" style={{ backgroundColor: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
              <Terminal size={12} />
              Register a test agent
            </div>
            <CopyButton text={curlRegister} label="Copy curl" />
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            Run this to confirm the round-trip works. A 201 response means the dashboard will show alice
            on the Agents view immediately (via WebSocket push).
          </p>
          <pre
            className="text-xs font-mono p-3 rounded-md overflow-x-auto whitespace-pre"
            style={{
              backgroundColor: 'var(--bg-code, rgba(0,0,0,0.2))',
            }}
          >
            {curlRegister}
          </pre>
        </div>

        {/* Docs pointer */}
        <div className="text-xs text-[var(--text-secondary)] text-center pt-2">
          Full integration spec:{' '}
          <code className="font-mono">packages/core/src/types/hermes-contract.ts</code>
        </div>
      </div>
    </div>
  );
}
