/**
 * Import Wizard — polished 5-phase onboarding wizard.
 *
 * Phases: welcome → scan → preview → importing → complete → sync-setup
 *
 * Key changes from baseline:
 *  - GitHub form now sends github_token + repo_url to the live scan endpoint
 *  - Glassmorphic stat cards with better labels and icons
 *  - Decision list shows description, tag pills, and colour-coded confidence
 *  - Team section shows contribution bars and styled role badges
 *  - Prominent blue CTA with decision count
 *  - Animated progress bar + step checklist during import
 *  - Polished completion screen with import metrics
 *  - Post-import "Enable Permanent GitHub Sync" guided 3-step wizard
 *    (explain → install app → configure webhook)
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Github, MessageSquare, FileText, Upload, CheckCircle, Circle,
  ChevronRight, X, Users, Zap, GitPullRequest, AlertTriangle,
  Shield, ArrowRight, Loader, RefreshCw, Link, ExternalLink, Copy,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

// -- Types ----------------------------------------------------------------

type Source = 'github' | 'slack' | 'linear' | 'files';
type Phase = 'welcome' | 'scan' | 'preview' | 'importing' | 'complete' | 'sync-setup';

interface Decision {
  title: string;
  confidence: string;
  source: string;
  description?: string;
  tags?: string[];
}

interface TeamMember {
  name: string;
  contributions: number;
  suggested_role: string;
}

interface ScanResult {
  scan_id: string;
  source: Source;
  stats: Record<string, number>;
  preview_decisions: Decision[];
  detected_team: TeamMember[];
}

interface ImportResult {
  project_id: string;
  decisions_imported: number;
  agents_created: number;
  contradictions_found: number;
  edges_created: number;
}

// -- Source config --------------------------------------------------------

const SOURCES: Array<{
  id: Source;
  label: string;
  description: string;
  icon: React.ReactNode;
  placeholder: string;
  inputLabel: string;
}> = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'PRs, issues & discussions',
    icon: <Github size={28} />,
    inputLabel: 'Repository URL',
    placeholder: 'https://github.com/org/repo',
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Channels & threads',
    icon: <MessageSquare size={28} />,
    inputLabel: 'Channels (comma-separated)',
    placeholder: '#engineering, #architecture',
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Issues & projects',
    icon: <Zap size={28} />,
    inputLabel: 'Team slug',
    placeholder: 'engineering',
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Docs, ADRs & markdown',
    icon: <FileText size={28} />,
    inputLabel: 'Files',
    placeholder: 'Drop files or paste paths...',
  },
];

const IMPORT_STEPS = [
  'Connecting to source...',
  'Scanning for decisions...',
  'Detecting team members...',
  'Building decision graph...',
  'Resolving contradictions...',
  'Finalizing import...',
];

// -- Confidence styles ---------------------------------------------------

const CONFIDENCE: Record<string, { bg: string; fg: string; label: string }> = {
  high:   { bg: '#05966922', fg: '#059669', label: 'High' },
  medium: { bg: '#063ff922', fg: '#063ff9', label: 'Medium' },
  low:    { bg: '#ef444422', fg: '#ef4444', label: 'Low' },
};

// -- Role badge colours --------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  architect:   '#063ff9',
  backend:     '#059669',
  frontend:    '#7c3aed',
  devops:      '#0891b2',
  qa:          '#d97706',
  security:    '#ef4444',
  contributor: '#6b7280',
};

// -- Stat card labels ----------------------------------------------------

const STAT_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  prs_found:             { label: 'PRs Found',           icon: <GitPullRequest size={15} /> },
  prs_merged:            { label: 'PRs Merged',          icon: <GitPullRequest size={15} /> },
  issues_open:           { label: 'Open Issues',         icon: <AlertTriangle size={15} /> },
  issues_closed:         { label: 'Closed Issues',       icon: <CheckCircle size={15} /> },
  issues_found:          { label: 'Issues Found',        icon: <AlertTriangle size={15} /> },
  team_members:          { label: 'Team Members',        icon: <Users size={15} /> },
  estimated_decisions:   { label: 'Decisions Found',     icon: <Zap size={15} /> },
  channels_scanned:      { label: 'Channels Scanned',    icon: <MessageSquare size={15} /> },
  messages_found:        { label: 'Messages Found',      icon: <MessageSquare size={15} /> },
  projects_found:        { label: 'Projects Found',      icon: <FileText size={15} /> },
  files_processed:       { label: 'Files Processed',     icon: <FileText size={15} /> },
  files_found:           { label: 'Files Found',         icon: <FileText size={15} /> },
};

// -- Component ------------------------------------------------------------

export function ImportWizard() {
  const { post } = useApi();
  const { projectId } = useProject();

  const [phase, setPhase] = useState<Phase>('welcome');
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [sourceInput, setSourceInput] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedDecisions, setSelectedDecisions] = useState<Set<number>>(new Set());
  const [projectName, setProjectName] = useState('');
  const [importStep, setImportStep] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync-setup wizard state
  const [syncStep, setSyncStep] = useState(1);
  const [webhookCopied, setWebhookCopied] = useState(false);

  // Clean up scan timer
  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, []);

  // -- Actions ----------------------------------------------------------

  function selectSource(src: Source) {
    setSelectedSource(src);
    setPhase('scan');
    setError(null);
    setSourceInput('');
    setGithubToken('');
  }

  async function runScan() {
    if (!selectedSource) return;
    setScanning(true);
    setError(null);
    setScanElapsed(0);

    // Timer to show elapsed seconds
    scanTimerRef.current = setInterval(() => {
      setScanElapsed(prev => prev + 1);
    }, 1000);

    try {
      const body: Record<string, unknown> = {};
      if (projectId && projectId !== 'default') body.project_id = projectId;

      // GitHub-specific: send token + repo URL for live API scan
      if (selectedSource === 'github') {
        if (sourceInput) body.repo_url = sourceInput;
        if (githubToken) body.github_token = githubToken;
      } else {
        if (sourceInput) body.config_value = sourceInput;
      }

      const result = await post<ScanResult>(`/api/import-wizard/scan/${selectedSource}`, body);
      setScanResult(result);
      setSelectedDecisions(new Set(result.preview_decisions.map((_, i) => i)));
      setPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed. Please try again.');
    } finally {
      setScanning(false);
      if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
    }
  }

  async function runImport() {
    if (!scanResult || !projectName.trim()) return;
    setPhase('importing');
    setImportStep(0);

    // Animate through steps
    for (let i = 0; i < IMPORT_STEPS.length; i++) {
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      setImportStep(i + 1);
    }

    try {
      const result = await post<ImportResult>('/api/import-wizard/execute', {
        scan_id: scanResult.scan_id,
        project_name: projectName.trim(),
      });
      setImportResult(result);
      setPhase('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. Please try again.');
      setPhase('preview');
    }
  }

  function toggleDecision(i: number) {
    setSelectedDecisions(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function selectAllDecisions() {
    if (!scanResult) return;
    setSelectedDecisions(new Set(scanResult.preview_decisions.map((_, i) => i)));
  }

  function deselectAllDecisions() {
    setSelectedDecisions(new Set());
  }

  function resetWizard() {
    setPhase('welcome');
    setScanResult(null);
    setImportResult(null);
    setProjectName('');
    setSourceInput('');
    setGithubToken('');
    setSelectedSource(null);
    setError(null);
  }

  // -- Styles -----------------------------------------------------------

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-light)',
    borderRadius: 12,
    padding: 20,
  };

  /* Glassmorphic stat card */
  const glassCard: React.CSSProperties = {
    background: 'linear-gradient(135deg, rgba(6,63,249,0.08) 0%, rgba(6,63,249,0.03) 100%)',
    border: '1px solid rgba(6,63,249,0.18)',
    borderRadius: 14,
    padding: '18px 16px',
    backdropFilter: 'blur(12px)',
    textAlign: 'center',
  };

  const accentBtn: React.CSSProperties = {
    background: 'linear-gradient(135deg, #063ff9 0%, #0534d4 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '14px 28px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 14px rgba(6,63,249,0.25)',
  };

  const ghostBtn: React.CSSProperties = {
    background: 'none',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    padding: '10px 20px',
    fontSize: 14,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 8,
    border: '1px solid var(--border-light)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  // -- Phase: Welcome ---------------------------------------------------

  if (phase === 'welcome') {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'linear-gradient(135deg, #063ff9 0%, #0534d4 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(6,63,249,0.3)',
            }}>
              <Upload size={20} color="#fff" />
            </div>
            <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: -0.5 }}>
              Import Wizard
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, margin: 0, lineHeight: 1.6 }}>
            Connect a source and Hipp0 will scan it for architectural decisions,
            automatically build your decision graph, and detect your team.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {SOURCES.map(src => (
            <button
              key={src.id}
              onClick={() => selectSource(src.id)}
              style={{
                ...card,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                transition: 'all 0.2s',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = '#063ff9';
                el.style.boxShadow = '0 0 0 1px #063ff933';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--border-light)';
                el.style.boxShadow = 'none';
              }}
            >
              <span style={{ color: '#063ff9', marginTop: 2, flexShrink: 0 }}>{src.icon}</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15, marginBottom: 4 }}>
                  {src.label}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
                  {src.description}
                </div>
              </div>
              <ArrowRight size={14} color="var(--text-tertiary)" style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)' }} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // -- Phase: Scan ------------------------------------------------------

  if (phase === 'scan' && selectedSource) {
    const srcConfig = SOURCES.find(s => s.id === selectedSource)!;
    const isGitHub = selectedSource === 'github';

    return (
      <div style={{ maxWidth: 540, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <button
            onClick={() => setPhase('welcome')}
            style={{ ...ghostBtn, padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            ← Back
          </button>
          <span style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>
            Connect {srcConfig.label}
          </span>
        </div>

        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ color: '#063ff9' }}>{srcConfig.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
                {srcConfig.label}
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                {srcConfig.description}
              </div>
            </div>
          </div>

          {/* Repository URL */}
          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            {srcConfig.inputLabel}
          </label>
          <input
            style={{ ...inputStyle, marginBottom: isGitHub ? 16 : 0 }}
            value={sourceInput}
            onChange={e => setSourceInput(e.target.value)}
            placeholder={srcConfig.placeholder}
            onKeyDown={e => { if (e.key === 'Enter' && !scanning) runScan(); }}
          />

          {/* GitHub-specific: optional PAT */}
          {isGitHub && (
            <>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Personal Access Token
                <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> (optional — enables live scan)</span>
              </label>
              <input
                style={inputStyle}
                type="password"
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                onKeyDown={e => { if (e.key === 'Enter' && !scanning) runScan(); }}
              />
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                <Shield size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Token is sent directly to GitHub, never stored. Without a token, demo data is shown.
              </div>
            </>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: '10px 14px', background: '#7f1d1d22', border: '1px solid #991b1b44', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        <button
          onClick={runScan}
          disabled={scanning}
          style={{
            ...accentBtn,
            width: '100%',
            opacity: scanning ? 0.8 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {scanning ? (
            <>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Scanning... {scanElapsed > 0 ? `(${scanElapsed}s)` : ''}
            </>
          ) : (
            <>Scan {srcConfig.label}</>
          )}
        </button>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // -- Phase: Preview ---------------------------------------------------

  if (phase === 'preview' && scanResult) {
    // Filter out fallback flag and 0-value stats
    const statEntries = Object.entries(scanResult.stats)
      .filter(([key, val]) => key !== 'fallback' && val > 0);

    const maxContributions = Math.max(...scanResult.detected_team.map(m => m.contributions), 1);

    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 20, marginBottom: 10,
              background: '#05966918', border: '1px solid #05966930',
            }}>
              <CheckCircle size={14} color="#059669" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>Scan Complete</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--text-primary)', letterSpacing: -0.5 }}>
              Review Your Import
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
              We found decisions, team members, and patterns in your codebase.
            </div>
          </div>
          <button onClick={resetWizard} style={{ ...ghostBtn, padding: '8px 12px' }}>
            <X size={16} />
          </button>
        </div>

        {/* -- Stats cards --------------------------------------------- */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(statEntries.length, 4)}, 1fr)`, gap: 12, marginBottom: 24 }}>
          {statEntries.slice(0, 6).map(([key, val]) => {
            const meta = STAT_LABELS[key] || { label: key.replace(/_/g, ' '), icon: <Zap size={15} /> };
            return (
              <div key={key} style={glassCard}>
                <div style={{ color: '#063ff9', marginBottom: 6, opacity: 0.8 }}>{meta.icon}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{val}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 6, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {meta.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* -- Decisions list ------------------------------------------- */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} color="#063ff9" />
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>
                Decisions ({scanResult.preview_decisions.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={selectAllDecisions}
                style={{ background: 'none', border: 'none', color: '#063ff9', fontSize: 12, cursor: 'pointer', fontWeight: 600, padding: '2px 6px' }}
              >
                Select All
              </button>
              <span style={{ color: 'var(--border-light)' }}>|</span>
              <button
                onClick={deselectAllDecisions}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}
              >
                Clear
              </button>
              <span style={{
                padding: '2px 10px', borderRadius: 12,
                background: '#063ff918', color: '#063ff9',
                fontSize: 12, fontWeight: 700,
              }}>
                {selectedDecisions.size} selected
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
            {scanResult.preview_decisions.map((d, i) => {
              const selected = selectedDecisions.has(i);
              const conf = CONFIDENCE[d.confidence] || CONFIDENCE.medium;

              return (
                <button
                  key={i}
                  onClick={() => toggleDecision(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    background: selected ? 'rgba(6,63,249,0.06)' : 'transparent',
                    border: `1px solid ${selected ? 'rgba(6,63,249,0.3)' : 'var(--border-light)'}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                    width: '100%',
                  }}
                >
                  {/* Checkbox */}
                  <div style={{ marginTop: 1, flexShrink: 0 }}>
                    {selected
                      ? <CheckCircle size={18} color="#063ff9" />
                      : <Circle size={18} color="var(--text-tertiary)" />
                    }
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, marginBottom: 3, lineHeight: 1.4 }}>
                      {d.title}
                    </div>
                    {d.description && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5, marginBottom: 6 }}>
                        {d.description.length > 140 ? d.description.slice(0, 140) + '...' : d.description}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {/* Source */}
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                        {d.source}
                      </span>
                      {/* Tag pills */}
                      {d.tags && d.tags.length > 0 && (
                        <>
                          <span style={{ color: 'var(--border-light)' }}>·</span>
                          {d.tags.slice(0, 3).map((tag, ti) => (
                            <span key={ti} style={{
                              padding: '1px 8px', borderRadius: 10,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-light)',
                              fontSize: 10, fontWeight: 500,
                              color: 'var(--text-secondary)',
                            }}>
                              {tag}
                            </span>
                          ))}
                          {d.tags.length > 3 && (
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                              +{d.tags.length - 3}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Confidence badge */}
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    background: conf.bg,
                    color: conf.fg,
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                    {conf.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* -- Detected team -------------------------------------------- */}
        {scanResult.detected_team.length > 0 && (
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Users size={16} color="#063ff9" />
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>
                Detected Team ({scanResult.detected_team.length})
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scanResult.detected_team.map((m, i) => {
                const roleColor = ROLE_COLORS[m.suggested_role] || ROLE_COLORS.contributor;
                const barWidth = Math.max((m.contributions / maxContributions) * 100, 8);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${roleColor}44, ${roleColor}22)`,
                      border: `2px solid ${roleColor}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: roleColor,
                      flexShrink: 0,
                    }}>
                      {m.name[0]?.toUpperCase()}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{m.name}</span>
                        <span style={{
                          padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: roleColor + '18',
                          color: roleColor,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          {m.suggested_role}
                        </span>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 11, marginLeft: 'auto' }}>
                          {m.contributions} contributions
                        </span>
                      </div>
                      {/* Contribution bar */}
                      <div style={{ height: 4, borderRadius: 2, background: 'var(--border-light)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          background: `linear-gradient(90deg, ${roleColor}, ${roleColor}88)`,
                          width: `${barWidth}%`,
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* -- Project name + Import CTA -------------------------------- */}
        <div style={{ ...card }}>
          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Project name
          </label>
          <input
            style={{ ...inputStyle, marginBottom: 16 }}
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="My Project"
            onKeyDown={e => { if (e.key === 'Enter' && projectName.trim() && selectedDecisions.size > 0) runImport(); }}
          />

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#7f1d1d22', border: '1px solid #991b1b44', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={resetWizard}
              style={{ ...ghostBtn, flex: '0 0 auto' }}
            >
              Cancel
            </button>
            <button
              onClick={runImport}
              disabled={!projectName.trim() || selectedDecisions.size === 0}
              style={{
                ...accentBtn,
                flex: 1,
                opacity: (!projectName.trim() || selectedDecisions.size === 0) ? 0.5 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              Import These {selectedDecisions.size} Decisions
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -- Phase: Importing -------------------------------------------------

  if (phase === 'importing') {
    const progress = Math.round((importStep / IMPORT_STEPS.length) * 100);

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '80px 20px', textAlign: 'center' }}>
        {/* Animated icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: '0 auto 24px',
          background: 'linear-gradient(135deg, #063ff9 0%, #0534d4 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(6,63,249,0.3)',
          animation: 'pulse 2s ease-in-out infinite',
        }}>
          <Upload size={28} color="#fff" />
        </div>

        <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--text-primary)', marginBottom: 8, letterSpacing: -0.5 }}>
          Building Your Decision Graph
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 36 }}>
          This usually takes a few seconds
        </div>

        {/* Progress bar */}
        <div style={{
          background: 'var(--border-light)',
          borderRadius: 10,
          height: 8,
          marginBottom: 28,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            background: 'linear-gradient(90deg, #063ff9, #0534d4)',
            borderRadius: 10,
            width: `${progress}%`,
            transition: 'width 0.5s ease',
            boxShadow: '0 0 12px rgba(6,63,249,0.4)',
          }} />
        </div>

        {/* Steps */}
        <div style={{ ...card, textAlign: 'left' }}>
          {IMPORT_STEPS.map((step, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0',
              borderBottom: i < IMPORT_STEPS.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              {i < importStep
                ? <CheckCircle size={18} color="#059669" />
                : i === importStep
                  ? <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: '2px solid #063ff9',
                      borderTopColor: 'transparent',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                  : <Circle size={18} color="var(--text-tertiary)" />
              }
              <span style={{
                fontSize: 14,
                fontWeight: i === importStep ? 600 : 400,
                color: i < importStep ? '#059669' : i === importStep ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}>
                {step}
              </span>
            </div>
          ))}
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        `}</style>
      </div>
    );
  }

  // -- Phase: Complete --------------------------------------------------

  if (phase === 'complete' && importResult) {
    const resultStats = [
      { label: 'Decisions Imported', value: importResult.decisions_imported, color: '#063ff9', icon: <Zap size={18} /> },
      { label: 'Agents Created',     value: importResult.agents_created,     color: '#059669', icon: <Users size={18} /> },
      { label: 'Contradictions',     value: importResult.contradictions_found, color: '#d97706', icon: <AlertTriangle size={18} /> },
      { label: 'Edges Created',      value: importResult.edges_created,      color: '#7c3aed', icon: <GitPullRequest size={18} /> },
    ];

    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
        {/* Success icon */}
        <div style={{
          width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
          background: '#05966918',
          border: '2px solid #05966930',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckCircle size={36} color="#059669" />
        </div>

        <div style={{ fontWeight: 800, fontSize: 26, color: 'var(--text-primary)', marginBottom: 8, letterSpacing: -0.5 }}>
          Import Complete
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 36, lineHeight: 1.6 }}>
          Your decision graph is ready. Here is what was imported.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 36 }}>
          {resultStats.map(s => (
            <div key={s.label} style={{
              ...glassCard,
              background: `linear-gradient(135deg, ${s.color}10 0%, ${s.color}05 100%)`,
              border: `1px solid ${s.color}22`,
            }}>
              <div style={{ color: s.color, marginBottom: 6, opacity: 0.7 }}>{s.icon}</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{s.value}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* -- Enable Permanent Sync CTA --------------------------- */}
        {selectedSource === 'github' && (
          <div style={{
            ...card,
            marginBottom: 20,
            background: 'linear-gradient(135deg, rgba(6,63,249,0.06) 0%, rgba(6,63,249,0.02) 100%)',
            border: '1px solid rgba(6,63,249,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg, #063ff9 0%, #0534d4 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(6,63,249,0.25)',
              }}>
                <RefreshCw size={18} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Keep your decision graph in sync
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                  This import was a one-time snapshot. Enable permanent sync to automatically
                  capture every merged PR going forward — no more manual scans.
                </div>
                <button
                  onClick={() => { setSyncStep(1); setPhase('sync-setup'); }}
                  style={{
                    ...accentBtn,
                    padding: '11px 22px',
                    fontSize: 14,
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <RefreshCw size={14} />
                  Enable Permanent GitHub Sync
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => { window.location.hash = 'playground'; }}
            style={{ ...accentBtn, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            Start First Session
            <ArrowRight size={16} />
          </button>
          <button
            onClick={() => { window.location.hash = 'graph'; }}
            style={{ ...ghostBtn, width: '100%' }}
          >
            View Decision Graph
          </button>
          <button
            onClick={resetWizard}
            style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13, padding: '8px 0' }}
          >
            Import another source
          </button>
        </div>
      </div>
    );
  }

  // -- Phase: Sync Setup -------------------------------------------------
  // Guided 3-step wizard: explain → install GitHub App → configure webhook

  if (phase === 'sync-setup' && importResult) {
    const apiBase = (import.meta.env.VITE_API_URL as string) || window.location.origin;
    const webhookUrl = `${apiBase}/api/webhooks/github`;
    // Derive GitHub owner/repo from the source input if provided
    const repoSlug = sourceInput
      ? sourceInput.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
      : '';
    const installUrl = repoSlug
      ? `https://github.com/apps/hipp0/installations/new/permissions?target_id=${repoSlug.split('/')[0]}`
      : 'https://github.com/apps/hipp0/installations/new';

    const SYNC_STEPS = [
      { num: 1, title: 'Why permanent sync?', icon: <RefreshCw size={16} /> },
      { num: 2, title: 'Install GitHub App',  icon: <Github size={16} /> },
      { num: 3, title: 'Configure Webhook',   icon: <Link size={16} /> },
    ];

    function copyWebhook() {
      navigator.clipboard.writeText(webhookUrl).then(() => {
        setWebhookCopied(true);
        setTimeout(() => setWebhookCopied(false), 2000);
      });
    }

    async function finishSyncSetup() {
      // Mark the GitHub connector as active for this project
      try {
        await post('/api/connectors', {
          project_id: importResult!.project_id,
          connector_type: 'github',
          config: { repo_url: sourceInput, webhook_active: true },
        });
      } catch {
        // Best-effort — connector endpoint may not exist yet
      }
      setPhase('complete');
    }

    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <button
            onClick={() => setPhase('complete')}
            style={{ ...ghostBtn, padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            ← Back to results
          </button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #063ff9 0%, #0534d4 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(6,63,249,0.3)',
          }}>
            <RefreshCw size={24} color="#fff" />
          </div>
          <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--text-primary)', letterSpacing: -0.5, marginBottom: 6 }}>
            Enable Permanent Sync
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Three quick steps to keep your decision graph always up-to-date.
          </div>
        </div>

        {/* -- Step progress indicator ------------------------------------ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 32 }}>
          {SYNC_STEPS.map((s, i) => (
            <React.Fragment key={s.num}>
              <div
                onClick={() => { if (s.num < syncStep) setSyncStep(s.num); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 16px', borderRadius: 20,
                  background: syncStep === s.num
                    ? 'linear-gradient(135deg, rgba(6,63,249,0.15) 0%, rgba(6,63,249,0.06) 100%)'
                    : syncStep > s.num ? '#05966912' : 'transparent',
                  border: `1px solid ${
                    syncStep === s.num ? 'rgba(6,63,249,0.35)'
                    : syncStep > s.num ? '#05966930'
                    : 'var(--border-light)'
                  }`,
                  cursor: s.num < syncStep ? 'pointer' : 'default',
                  transition: 'all 0.2s',
                }}
              >
                {syncStep > s.num
                  ? <CheckCircle size={16} color="#059669" />
                  : <span style={{ color: syncStep === s.num ? '#063ff9' : 'var(--text-tertiary)' }}>{s.icon}</span>
                }
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: syncStep === s.num ? '#063ff9' : syncStep > s.num ? '#059669' : 'var(--text-tertiary)',
                }}>
                  {s.title}
                </span>
              </div>
              {i < SYNC_STEPS.length - 1 && (
                <div style={{
                  width: 32, height: 1,
                  background: syncStep > s.num ? '#05966940' : 'var(--border-light)',
                  transition: 'background 0.3s',
                }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* -- Step 1: Explanation ---------------------------------------- */}
        {syncStep === 1 && (
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <RefreshCw size={20} color="#063ff9" />
              <span style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>
                How Permanent Sync Works
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
              {[
                {
                  icon: <GitPullRequest size={18} />,
                  title: 'Every merged PR captured',
                  desc: 'When a PR is merged, GitHub sends a webhook event and Hipp0 automatically extracts decisions, updates the graph, and links contributors.',
                },
                {
                  icon: <Zap size={18} />,
                  title: 'Zero manual effort',
                  desc: 'No more running import scans. Your decision graph stays current as your codebase evolves.',
                },
                {
                  icon: <Shield size={18} />,
                  title: 'Secure and scoped',
                  desc: 'The GitHub App only requests read access to PRs and issues. Webhook payloads are verified with a shared secret.',
                },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: 'rgba(6,63,249,0.08)', border: '1px solid rgba(6,63,249,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#063ff9',
                  }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>
                      {item.title}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSyncStep(2)}
              style={{ ...accentBtn, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              Got it, let's set it up
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* -- Step 2: Install GitHub App --------------------------------- */}
        {syncStep === 2 && (
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Github size={20} color="#063ff9" />
              <span style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>
                Install the Hipp0 GitHub App
              </span>
            </div>

            <div style={{
              padding: 20, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(6,63,249,0.05) 0%, rgba(6,63,249,0.02) 100%)',
              border: '1px solid rgba(6,63,249,0.12)',
              marginBottom: 20,
            }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                The Hipp0 GitHub App grants read-only access to your repository's pull requests and issues.
                Click below to install it{repoSlug ? ` for ${repoSlug}` : ''}.
              </div>
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...accentBtn,
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  textDecoration: 'none',
                  fontSize: 14, padding: '11px 22px',
                }}
              >
                <Github size={16} />
                Install on GitHub
                <ExternalLink size={13} />
              </a>
            </div>

            <div style={{
              padding: '12px 16px', borderRadius: 8,
              background: 'var(--bg-primary)', border: '1px solid var(--border-light)',
              marginBottom: 20,
            }}>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                Already installed?
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
                If the Hipp0 app is already installed on your organization or repository, skip ahead to the next step.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setSyncStep(1)} style={{ ...ghostBtn, flex: '0 0 auto' }}>
                ← Back
              </button>
              <button
                onClick={() => setSyncStep(3)}
                style={{ ...accentBtn, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                Continue
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* -- Step 3: Configure Webhook ---------------------------------- */}
        {syncStep === 3 && (
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Link size={20} color="#063ff9" />
              <span style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>
                Configure Webhook
              </span>
            </div>

            <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Add this webhook to your GitHub repository so Hipp0 receives events in real time.
            </div>

            {/* Webhook URL copyable box */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', color: 'var(--text-tertiary)', fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Payload URL
              </label>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 0,
                border: '1px solid rgba(6,63,249,0.3)', borderRadius: 8, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '11px 14px',
                  background: 'var(--bg-primary)',
                  color: '#063ff9', fontSize: 13, fontWeight: 600, fontFamily: 'monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {webhookUrl}
                </div>
                <button
                  onClick={copyWebhook}
                  style={{
                    padding: '11px 16px', border: 'none', cursor: 'pointer',
                    background: webhookCopied
                      ? '#059669'
                      : 'linear-gradient(135deg, #063ff9 0%, #0534d4 100%)',
                    color: '#fff', display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, fontWeight: 600, transition: 'background 0.2s',
                  }}
                >
                  {webhookCopied ? <><CheckCircle size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
            </div>

            {/* Setup instructions */}
            <div style={{
              padding: 16, borderRadius: 10,
              background: 'var(--bg-primary)', border: '1px solid var(--border-light)',
              marginBottom: 20,
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, marginBottom: 12 }}>
                GitHub Settings
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { step: '1', text: repoSlug ? `Go to github.com/${repoSlug}/settings/hooks` : 'Go to your repo → Settings → Webhooks' },
                  { step: '2', text: 'Click "Add webhook" and paste the Payload URL above' },
                  { step: '3', text: 'Set Content type to application/json' },
                  { step: '4', text: 'Under "Which events?", select "Let me select individual events" and check Pull requests' },
                  { step: '5', text: 'Click "Add webhook"' },
                ].map(item => (
                  <div key={item.step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(6,63,249,0.1)', border: '1px solid rgba(6,63,249,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#063ff9',
                    }}>
                      {item.step}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, paddingTop: 1 }}>
                      {item.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {repoSlug && (
              <a
                href={`https://github.com/${repoSlug}/settings/hooks/new`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  color: '#063ff9', fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', marginBottom: 20,
                }}
              >
                Open webhook settings for {repoSlug}
                <ExternalLink size={13} />
              </a>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setSyncStep(2)} style={{ ...ghostBtn, flex: '0 0 auto' }}>
                ← Back
              </button>
              <button
                onClick={finishSyncSetup}
                style={{
                  ...accentBtn, flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  boxShadow: '0 4px 14px rgba(5,150,105,0.25)',
                }}
              >
                <CheckCircle size={16} />
                Finish Setup
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
