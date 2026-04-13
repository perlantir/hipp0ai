import { useState, type FormEvent } from 'react';

interface LoginProps {
  onLogin: (apiKey: string) => void;
  error?: string | null;
}

export function Login({ onLogin, error }: LoginProps) {
  const [apiKey, setApiKey] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (apiKey.trim()) {
      onLogin(apiKey.trim());
    }
  }

  return (
    <div
      className="flex items-center justify-center min-h-screen relative overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Swarm background orbs */}
      <div style={{ position: 'fixed', top: '-10%', left: '-10%', width: '50%', height: '50%', background: 'rgba(6,63,249,0.15)', borderRadius: '50%', filter: 'blur(120px)', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-10%', right: '-10%', width: '60%', height: '60%', background: 'rgba(255,46,147,0.1)', borderRadius: '50%', filter: 'blur(120px)', zIndex: 0 }} />
      <div style={{ position: 'fixed', top: '20%', right: '10%', width: '30%', height: '30%', background: 'rgba(255,235,59,0.08)', borderRadius: '50%', filter: 'blur(120px)', zIndex: 0 }} />

      <div
        className="w-full max-w-md p-8 relative z-10"
        style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}
      >
        {/* Logo Section */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.5)' }}>
            <span className="text-4xl font-bold" style={{ color: 'var(--accent-primary)' }}>H</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tighter" style={{ color: 'var(--text-primary)' }}>HIPP0</h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-secondary)' }}>Decision memory for AI agent teams.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="api-key"
              className="block text-xs font-bold uppercase tracking-widest mb-2 ml-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Secret Key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              autoFocus
              className="w-full px-4 py-3 rounded-xl text-sm"
              style={{
                background: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.4)',
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            />
          </div>
          {error && (
            <p className="text-sm text-red-500 font-medium">{error}</p>
          )}
          <button
            type="submit"
            className="w-full px-4 py-4 text-white rounded-xl text-sm font-bold transition-all hover:-translate-y-0.5 active:scale-[0.98]"
            style={{ background: 'var(--accent-primary)', boxShadow: '0 0 20px rgba(6,63,249,0.4)' }}
          >
            Sign In
          </button>
        </form>

        <div className="mt-6 space-y-1 text-center">
          <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
            Your API key is on the server at /etc/team-hippo/api-key.txt
          </p>
        </div>
      </div>
    </div>
  );
}
