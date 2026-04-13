import { useState, useRef, useEffect } from 'react';
import {
  Search as SearchIcon,
  Loader2,
  ChevronDown,
  ChevronUp,
  Tag,
  User,
  Clock,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { SearchResult, Decision } from '../types';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Search() {
  const { post } = useApi();
  const { projectId } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const data = await post<SearchResult[]>(`/api/projects/${projectId}/decisions/search`, {
        query: query.trim(),
      });
      setResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function scoreLabel(score: number): string {
    if (score >= 0.9) return 'Excellent';
    if (score >= 0.7) return 'Good';
    if (score >= 0.5) return 'Fair';
    return 'Low';
  }

  function scoreColor(score: number): string {
    if (score >= 0.7) return 'text-status-active';
    if (score >= 0.5) return 'text-primary';
    return 'text-[var(--text-secondary)]';
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 lg:px-12 pt-12 pb-24">
        {/* Hero Search Section */}
        <section className="mb-16">
          <h1 className="text-6xl font-bold tracking-tight mb-8" style={{ color: 'var(--text-primary)' }}>
            Explore <span className="text-primary">Intelligence.</span>
          </h1>

          {/* Search bar */}
          <form onSubmit={handleSearch}>
            <div className="p-2 rounded-2xl shadow-lg transition-all duration-500" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
              <div className="flex items-center gap-4 px-6 h-20">
                <SearchIcon
                  size={28}
                  className="text-primary shrink-0"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search decisions..."
                  className="w-full bg-transparent border-none text-2xl font-medium focus:ring-0 focus:outline-none placeholder:opacity-40"
                  style={{ color: 'var(--text-primary)' }}
                />
                {loading ? (
                  <Loader2
                    size={18}
                    className="animate-spin text-primary shrink-0"
                  />
                ) : (
                  <button
                    type="submit"
                    className="bg-primary text-white px-8 h-12 rounded-xl font-bold shrink-0 transition-all"
                    style={{ boxShadow: 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 0 20px rgba(6,63,249,0.4)')}
                    onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    Execute
                  </button>
                )}
              </div>
            </div>
          </form>

          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <div className="px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium cursor-pointer transition-colors" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', color: 'var(--text-secondary)' }}>
              <User size={14} />
              <span>Agent</span>
              <ChevronDown size={12} />
            </div>
            <div className="px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium cursor-pointer transition-colors" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', color: 'var(--text-secondary)' }}>
              <Tag size={14} />
              <span>Tags</span>
              <ChevronDown size={12} />
            </div>
            <div className="px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium cursor-pointer transition-colors" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', color: 'var(--text-secondary)' }}>
              <Clock size={14} />
              <span>Date Range</span>
              <ChevronDown size={12} />
            </div>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
            <p className="text-sm text-status-reverted">{error}</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="animate-fade-in">
            {/* Results Section Header */}
            <div className="flex items-center justify-between mb-8 pb-4" style={{ borderBottom: '1px solid rgba(107,114,128,0.1)' }}>
              <h2 className="text-2xl font-bold flex items-center gap-3">
                Results
                <span className="text-sm px-3 py-1 rounded-lg" style={{ background: 'rgba(6,63,249,0.1)', color: '#063ff9' }}>
                  {results.length} match{results.length !== 1 ? 'es' : ''}
                </span>
              </h2>
              <div className="flex items-center gap-4">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Sort by: <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Similarity</span>
                </span>
              </div>
            </div>

            {/* Result Cards List */}
            <div className="grid grid-cols-1 gap-6">
              {results.map((result) => {
                const isExpanded = expanded.has(result.decision.id);
                const d = result.decision;

                return (
                  <div key={d.id} className="p-8 rounded-2xl hover:-translate-y-1 transition-all duration-300 group relative overflow-hidden" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
                    {/* Decorative orb */}
                    <div className="absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700" style={{ background: 'rgba(6,63,249,0.05)' }}></div>

                    {/* Header row */}
                    <button
                      onClick={() => toggleExpand(d.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between mb-6">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`badge badge-${d.status} text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded`}>{d.status}</span>
                          </div>
                          <h3 className="text-2xl font-bold group-hover:text-primary transition-colors" style={{ color: 'var(--text-primary)' }}>{d.title}</h3>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <div className="text-3xl font-bold text-primary tracking-tighter">
                            {(result.score * 100).toFixed(0)}%
                          </div>
                          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>
                            {scoreLabel(result.score)}
                          </div>
                        </div>
                      </div>

                      {/* Snippet */}
                      <p className="text-lg leading-relaxed mb-6 max-w-3xl line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                        {result.snippet || d.description}
                      </p>

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center justify-between gap-4 pt-6" style={{ borderTop: '1px solid rgba(107,114,128,0.1)' }}>
                        <div className="flex items-center gap-4">
                          {d.made_by && (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(6,63,249,0.2)' }}>
                                <User size={10} className="text-primary" />
                              </div>
                              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{d.made_by}</span>
                            </div>
                          )}
                          {d.tags.length > 0 && (
                            <>
                              <div className="h-4 w-px" style={{ background: 'rgba(107,114,128,0.2)' }}></div>
                              <div className="flex gap-2">
                                {d.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: 'rgba(255,46,147,0.3)', color: '#ff2e93' }}>#{tag}</span>
                                ))}
                                {d.tags.length > 3 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>+{d.tags.length - 3}</span>}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {d.namespace && (
                            <span className="text-primary" style={{
                              display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                              backgroundColor: 'rgba(59,130,246,0.13)', border: '1px solid rgba(59,130,246,0.27)',
                            }}>
                              ns:{d.namespace}
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp
                              size={16}
                              className="text-[var(--text-secondary)]"
                            />
                          ) : (
                            <ChevronDown
                              size={16}
                              className="text-[var(--text-secondary)]"
                            />
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-0 pb-0 pt-6 animate-fade-in" style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }}>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                          <div>
                            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                              Made by
                            </label>
                            <p className="flex items-center gap-1.5 font-medium">
                              <User size={12} />
                              {d.made_by}
                            </p>
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                              Date
                            </label>
                            <p className="flex items-center gap-1.5 font-medium">
                              <Clock size={12} />
                              {new Date(d.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div className="mb-4">
                          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                            Description
                          </label>
                          <p className="text-sm leading-relaxed">{d.description}</p>
                        </div>

                        {d.reasoning && (
                          <div className="mb-4">
                            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                              Reasoning
                            </label>
                            <p className="text-sm leading-relaxed">{d.reasoning}</p>
                          </div>
                        )}

                        {d.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {d.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[11px] font-bold px-2 py-1 rounded"
                                style={{ background: 'rgba(255,46,147,0.3)', color: '#ff2e93' }}
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {searched && results.length === 0 && !loading && !error && (
          <div className="text-center py-16">
            <SearchIcon
              size={32}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No decisions found for &ldquo;{query}&rdquo;
            </p>
          </div>
        )}

        {/* Initial state */}
        {!searched && !loading && (
          <div className="text-center py-24">
            <SearchIcon
              size={40}
              className="mx-auto mb-4 text-[var(--text-tertiary)]"
            />
            <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>
              Type a query and press Enter to search
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
