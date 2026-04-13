import { useState, useEffect } from 'react';
import { Play, Columns2, Loader2, ChevronDown } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface ScoredDecision {
  id?: string;
  title: string;
  description?: string;
  score?: number;
  status?: string;
  reasoning?: string;
  wing?: string | null;
  made_by?: string;
  namespace?: string | null;
}

interface CompileResult {
  decisions?: ScoredDecision[];
  context_used?: number;
  agent_name?: string;
  wing_sources?: Record<string, number>;
  [key: string]: unknown;
}

const WING_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

function wingColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return WING_COLORS[Math.abs(hash) % WING_COLORS.length];
}

export function CompileTester() {
  const { get, post } = useApi();
  const { projectId } = useProject();

  const [agents, setAgents] = useState<Array<{ name: string }>>([]);
  const [agentName, setAgentName] = useState('');
  const [agentName2, setAgentName2] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [result, setResult] = useState<CompileResult | null>(null);
  const [result2, setResult2] = useState<CompileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const [namespace, setNamespace] = useState('');
  const [namespaces, setNamespaces] = useState<Array<{ namespace: string; count: number }>>([]);

  useEffect(() => {
    get<Array<{ name: string }>>(`/api/projects/${projectId}/agents`)
      .then((data) => {
        if (Array.isArray(data)) setAgents(data);
      })
      .catch(() => {});
    get<Array<{ namespace: string; count: number }>>(`/api/projects/${projectId}/namespaces`)
      .then((data) => {
        if (Array.isArray(data)) setNamespaces(data);
      })
      .catch(() => {});
  }, [get, projectId]);

  async function runCompile(agent: string, setRes: (r: CompileResult | null) => void, setErr: (e: string | null) => void, setLoad: (l: boolean) => void) {
    if (!agent || !taskDescription.trim()) return;
    setLoad(true);
    setErr(null);
    setRes(null);
    try {
      const data = await post<CompileResult>('/api/compile', {
        agent_name: agent,
        project_id: projectId,
        task_description: taskDescription.trim(),
        ...(namespace ? { namespace } : {}),
      });
      setRes(data);
    } catch (err: any) {
      setErr(err.message || 'Compile failed');
    } finally {
      setLoad(false);
    }
  }

  function handleCompile() {
    runCompile(agentName, setResult, setError, setLoading);
    if (sideBySide && agentName2) {
      runCompile(agentName2, setResult2, setError2, setLoading2);
    }
  }

  return (
    <div className="px-8 pt-6 pb-20 max-w-[1600px] mx-auto min-h-screen">
      <div className="flex flex-col gap-8">
        {/* Header Section */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-4xl font-bold tracking-tight">Compile Tester</h2>
            <button
              onClick={() => { setSideBySide(!sideBySide); setResult2(null); setError2(null); }}
              className={`btn-secondary text-xs gap-1.5 rounded-xl ${sideBySide ? 'bg-[#063ff9]/10 text-[#063ff9]' : ''}`}
            >
              <Columns2 size={14} />
              {sideBySide ? 'Single Mode' : 'Side-by-Side'}
            </button>
          </div>
          <p className="text-[var(--text-secondary)] text-lg">Verify multi-agent logic chains and evaluate decision-to-markdown rendering.</p>
        </section>

        {/* Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Configuration Panel */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="p-6 rounded-2xl shadow-sm" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
              <div className="flex items-center gap-2 mb-6 text-[#063ff9]">
                <Play size={18} />
                <h3 className="font-bold text-lg">Execution Params</h3>
              </div>
              <div className="space-y-6">
                {/* Agent select */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Agent</label>
                  <div className="relative">
                    <select value={agentName} onChange={(e) => setAgentName(e.target.value)} className="w-full bg-white/80 rounded-xl px-4 py-3 text-[var(--text-primary)] focus:ring-[#063ff9] focus:border-[#063ff9] transition-all appearance-none pr-8" style={{ border: '1px solid rgba(255,255,255,0.4)' }}>
                      <option value="">Select agent...</option>
                      {agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]" />
                  </div>
                </div>

                {/* Agent B (side-by-side) */}
                {sideBySide && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Agent B</label>
                    <div className="relative">
                      <select value={agentName2} onChange={(e) => setAgentName2(e.target.value)} className="w-full bg-white/80 rounded-xl px-4 py-3 text-[var(--text-primary)] focus:ring-[#063ff9] focus:border-[#063ff9] transition-all appearance-none pr-8" style={{ border: '1px solid rgba(255,255,255,0.4)' }}>
                        <option value="">Select agent...</option>
                        {agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]" />
                    </div>
                  </div>
                )}

                {/* Task Description */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Task Definition</label>
                  <textarea
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder="Enter high-level task instructions..."
                    rows={6}
                    className="w-full bg-white/80 rounded-xl px-4 py-3 text-[var(--text-primary)] focus:ring-[#063ff9] focus:border-[#063ff9] transition-all resize-none"
                    style={{ border: '1px solid rgba(255,255,255,0.4)' }}
                  />
                </div>

                {/* Namespace */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Namespace (Optional)</label>
                  <div className="relative">
                    <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="w-full bg-white/80 rounded-xl px-4 py-3 text-[var(--text-primary)] focus:ring-[#063ff9] focus:border-[#063ff9] transition-all appearance-none pr-8" style={{ border: '1px solid rgba(255,255,255,0.4)' }}>
                      <option value="">All (no filter)</option>
                      {namespaces.map((ns) => <option key={ns.namespace} value={ns.namespace}>{ns.namespace} ({ns.count})</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]" />
                  </div>
                </div>

                {/* Compile Button */}
                <button
                  onClick={handleCompile}
                  disabled={!agentName || !taskDescription.trim() || loading}
                  className="w-full py-4 rounded-xl font-bold text-lg text-white bg-[#063ff9] shadow-[0_10px_20px_rgba(6,63,249,0.2)] hover:shadow-[0_15px_30px_rgba(6,63,249,0.4)] hover:-translate-y-1 active:translate-y-0 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_10px_20px_rgba(6,63,249,0.2)]"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                  Compile
                </button>
              </div>
            </div>

            {/* Status Panel */}
            <div className="p-6 rounded-2xl" style={{ background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.6)' }}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-4">Live Diagnostics</h3>
              <div className="flex items-center justify-between text-sm py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <span className="text-[var(--text-secondary)]">Endpoint Status</span>
                <span className="flex items-center gap-1.5 text-green-600 font-bold">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  READY
                </span>
              </div>
              <div className="flex items-center justify-between text-sm py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <span className="text-[var(--text-secondary)]">Worker Latency</span>
                <span className="font-medium">12ms</span>
              </div>
              <div className="flex items-center justify-between text-sm py-2">
                <span className="text-[var(--text-secondary)]">Context Window</span>
                <span className="font-medium text-[#063ff9]">128k Tokens</span>
              </div>
            </div>
          </div>

          {/* Right: Results & Output Views */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* Results */}
            <div className={`grid gap-6 ${sideBySide ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              <ResultColumn label={sideBySide ? `Agent A: ${agentName || '\u2014'}` : undefined} result={result} loading={loading} error={error} />
              {sideBySide && (
                <ResultColumn label={`Agent B: ${agentName2 || '\u2014'}`} result={result2} loading={loading2} error={error2} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultColumn({ label, result, loading, error }: { label?: string; result: CompileResult | null; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[200px] rounded-3xl shadow-xl" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.8)' }}>
        <Loader2 size={24} className="animate-spin text-[#063ff9]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl shadow-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.8)' }}>
        <div className="p-8">
          {label && <h3 className="text-sm font-bold mb-3">{label}</h3>}
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const decisions = result.decisions ?? [];
  const wingSources = result.wing_sources;

  return (
    <div className="flex flex-col gap-4">
      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Decisions Compiled</p>
          <p className="text-2xl font-bold">{decisions.length}</p>
        </div>
        <div className="p-4 rounded-2xl border-l-4 border-l-[#063ff9]" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', borderLeftWidth: '4px', borderLeftColor: '#3b82f6' }}>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Context Used</p>
          <p className="text-2xl font-bold text-[#063ff9]">{result.context_used ?? '—'}</p>
        </div>
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', borderLeftWidth: '4px', borderLeftColor: '#22c55e' }}>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Status</p>
          <p className="text-2xl font-bold text-green-600">{decisions.length > 0 ? 'COMPLETE' : 'EMPTY'}</p>
        </div>
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Agent</p>
          <p className="text-2xl font-bold truncate">{result.agent_name ?? '—'}</p>
        </div>
      </div>

      {/* Output Panel with Tabs */}
      <div className="rounded-3xl shadow-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.8)' }}>
        {/* Tab Bar */}
        <div className="flex items-center px-6 py-4 border-b" style={{ background: 'rgba(255,255,255,0.4)', borderColor: 'rgba(255,255,255,0.4)' }}>
          {label && <span className="text-sm font-bold mr-4">{label}</span>}
          <div className="flex gap-4">
            <span className="px-4 py-2 text-[#063ff9] font-bold border-b-2 border-[#063ff9] text-sm">Decisions</span>
            <span className="px-4 py-2 text-[var(--text-secondary)] text-sm font-medium">Raw JSON</span>
          </div>
        </div>

        {/* Wing sources */}
        {wingSources && Object.keys(wingSources).length > 0 && (
          <div className="px-8 pt-6 pb-0" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(wingSources).sort(([,a],[,b]) => b - a).map(([wing, count]) => {
              const color = wing === 'own_wing' ? '#10b981' : wingColor(wing);
              return (
                <span key={wing} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
                  backgroundColor: color + '15', color, border: `1px solid ${color}30`,
                }}>
                  {wing} <span style={{ fontWeight: 400, opacity: 0.7 }}>({count})</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Decision List */}
        <div className="p-8 min-h-[300px]">
          {decisions.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No decisions returned</p>
          ) : (
            <div className="space-y-3">
              {decisions.map((d, i) => {
                const dWing = d.wing ?? d.made_by;
                const dWingColor = dWing ? wingColor(dWing) : '#6b7280';
                return (
                  <div key={d.id ?? i} className="p-4 rounded-2xl border bg-white/50" style={{ borderColor: 'var(--border-light)' }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {dWing && (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
                            backgroundColor: dWingColor + '15', color: dWingColor, border: `1px solid ${dWingColor}30`,
                          }}>
                            {dWing}
                          </span>
                        )}
                        {d.namespace && (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
                            backgroundColor: '#6366f115', color: '#6366f1', border: '1px solid #6366f130',
                          }}>
                            ns:{d.namespace}
                          </span>
                        )}
                        <span className="text-sm font-bold">{d.title}</span>
                      </div>
                      {d.score != null && (
                        <span className="text-xs font-mono px-3 py-1 rounded-full bg-[#063ff9]/10 text-[#063ff9] font-bold">
                          {d.score.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {d.description && <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{d.description}</p>}
                    {d.reasoning && <p className="text-xs text-[var(--text-tertiary)] mt-1.5 italic">{d.reasoning}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
