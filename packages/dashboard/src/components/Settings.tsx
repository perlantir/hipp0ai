import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Key,
  Link,
  Plug,
  Eye,
  EyeOff,
  LogOut,
  Check,
  X,
} from 'lucide-react';
import { HermesSetup } from './HermesSetup';
import { Connectors } from './Connectors';

/* ------------------------------------------------------------------ */
/*  Collapsible section wrapper                                        */
/* ------------------------------------------------------------------ */

function Section({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-light)',
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: 15,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div style={{ padding: '0 18px 18px' }}>{children}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  API Key management section                                         */
/* ------------------------------------------------------------------ */

function ApiKeySection() {
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    try {
      setCurrentKey(localStorage.getItem('hipp0_api_key'));
    } catch { /* ignore */ }
  }, []);

  function handleSave() {
    if (!inputValue.trim()) return;
    try {
      localStorage.setItem('hipp0_api_key', inputValue.trim());
      setCurrentKey(inputValue.trim());
      setStatus({ type: 'success', message: 'API key saved' });
      setTimeout(() => setStatus(null), 3000);
    } catch {
      setStatus({ type: 'error', message: 'Failed to save — localStorage unavailable' });
    }
  }

  async function handleTest() {
    const key = inputValue.trim() || currentKey;
    if (!key) {
      setStatus({ type: 'error', message: 'No API key to test' });
      return;
    }
    setStatus(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/projects`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        setStatus({ type: 'success', message: 'Connected — API is reachable' });
      } else {
        setStatus({ type: 'error', message: `Failed: HTTP ${res.status}` });
      }
    } catch (err) {
      setStatus({ type: 'error', message: `Failed: ${err instanceof Error ? err.message : 'network error'}` });
    }
  }

  function handleSignOut() {
    try {
      localStorage.removeItem('hipp0_api_key');
    } catch { /* ignore */ }
    window.location.reload();
  }

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid var(--border-light)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  };

  return (
    <div>
      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: currentKey ? '#22c55e' : '#ef4444',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {currentKey
            ? `API Key: ${currentKey.slice(0, 8)}...`
            : 'No API key configured'}
        </span>
      </div>

      {/* Input */}
      <input
        type={showKey ? 'text' : 'password'}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Enter your API key"
        style={{
          width: '100%',
          padding: '9px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-light)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          outline: 'none',
          marginBottom: 10,
          boxSizing: 'border-box',
        }}
      />

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={handleSave} style={btnStyle}>
          <Check size={14} /> Save
        </button>
        <button onClick={() => setShowKey((s) => !s)} style={btnStyle}>
          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          {showKey ? 'Hide' : 'Show'}
        </button>
        <button onClick={handleTest} style={btnStyle}>
          <Link size={14} /> Test Connection
        </button>
        <button
          onClick={handleSignOut}
          style={{ ...btnStyle, color: '#ef4444', borderColor: '#ef444444' }}
        >
          <LogOut size={14} /> Sign Out
        </button>
      </div>

      {/* Status message */}
      {status && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: status.type === 'success' ? '#22c55e' : '#ef4444',
            marginBottom: 8,
          }}
        >
          {status.type === 'success' ? <Check size={14} /> : <X size={14} />}
          {status.message}
        </div>
      )}

      {/* Help text */}
      <p style={{ color: 'var(--text-tertiary)', fontSize: 11, margin: 0 }}>
        This key is stored in your browser only and never sent to any third party.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SettingsView — main settings page                                  */
/* ------------------------------------------------------------------ */

export function SettingsView() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h2
        style={{
          color: 'var(--text-primary)',
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 20,
          fontFamily: 'var(--font-heading)',
        }}
      >
        Settings
      </h2>

      <Section title="API Key" icon={<Key size={18} />} defaultOpen>
        <ApiKeySection />
      </Section>

      <Section title="Connection" icon={<Link size={18} />}>
        <HermesSetup />
      </Section>

      <Section title="Integrations" icon={<Plug size={18} />}>
        <Connectors />
      </Section>
    </div>
  );
}
