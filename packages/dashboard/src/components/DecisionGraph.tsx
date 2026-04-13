import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { X, Filter, ZoomIn, ZoomOut, Maximize2, Loader2, GitBranch, Search as SearchIcon, ChevronDown } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { Decision, DecisionStatus, GraphNode, GraphEdge } from '../types';
import { LinkedPRs } from './LinkedPRs';
import { wingColor } from './WingView';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<DecisionStatus, string> = {
  active: '#10B981',
  superseded: '#94A3B8',
  reverted: '#BA1A1A',
  pending: '#F59E0B',
};

const EDGE_PATTERNS: Record<string, string> = {
  depends_on: '8,4',
  conflicts_with: '2,4',
  relates_to: '12,4',
  blocks: '4,4',
  supersedes: '',
};

const NODE_RADIUS = 24;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DecisionGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  const { get } = useApi();
  const { projectId } = useProject();

  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Decision | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Filters
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<Set<DecisionStatus>>(
    new Set(['active', 'superseded', 'reverted', 'pending']),
  );
  const [showFilters, setShowFilters] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterAgent, setFilterAgent] = useState<string>('');
  const [filterDomain, setFilterDomain] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterWing, setFilterWing] = useState<string>('');
  const [colorByWing, setColorByWing] = useState(false);

  /* ---- Fetch data ------------------------------------------------ */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    get<Decision[]>(`/api/projects/${projectId}/decisions?limit=500`)
      .then((data) => {
        if (!cancelled) {
          setDecisions(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load decisions');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  /* ---- All tags & agents ------------------------------------------ */
  const allTags = Array.from(new Set(decisions.flatMap((d) => d.tags)));
  const allAgents = Array.from(new Set(decisions.map((d) => d.made_by).filter(Boolean)));
  const allDomains = Array.from(new Set(decisions.map((d) => d.domain).filter(Boolean))) as string[];
  const allCategories = Array.from(new Set(decisions.map((d) => d.category).filter(Boolean))) as string[];
  const allWings = Array.from(new Set(decisions.map((d) => d.wing ?? d.made_by).filter(Boolean))) as string[];

  /* ---- Filter decisions ------------------------------------------ */
  const filtered = decisions.filter((d) => {
    if (!filterStatus.has(d.status)) return false;
    if (filterTag && !d.tags.includes(filterTag)) return false;
    if (filterAgent && d.made_by !== filterAgent) return false;
    if (filterDomain && d.domain !== filterDomain) return false;
    if (filterCategory && d.category !== filterCategory) return false;
    if (filterWing && (d.wing ?? d.made_by) !== filterWing) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const matchTitle = d.title.toLowerCase().includes(q);
      const matchDesc = (d.description || '').toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }
    return true;
  });

  /* ---- Build graph data ------------------------------------------ */
  const buildGraph = useCallback(() => {
    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    filtered.forEach((d) => {
      nodeMap.set(d.id, {
        id: d.id,
        title: d.title,
        status: d.status,
        tags: d.tags,
        made_by: d.made_by,
        wing: d.wing,
        domain: d.domain,
      });
    });

    filtered.forEach((d) => {
      if (d.relationships) {
        (d.relationships ?? []).forEach((rel) => {
          if (nodeMap.has(rel.target_id)) {
            edges.push({
              source: d.id,
              target: rel.target_id,
              type: rel.type,
              description: rel.description,
            });
          }
        });
      }
      if (d.supersedes && nodeMap.has(d.supersedes)) {
        edges.push({
          source: d.id,
          target: d.supersedes,
          type: 'supersedes',
        });
      }
    });

    return { nodes: Array.from(nodeMap.values()), edges };
  }, [filtered]);

  /* ---- D3 rendering ---------------------------------------------- */
  useEffect(() => {
    if (loading || !svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = containerRef.current.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    svg.attr('width', width).attr('height', height);

    const { nodes, edges } = buildGraph();

    if (nodes.length === 0) return;

    /* Defs for arrow markers */
    const defs = svg.append('defs');
    Object.keys(STATUS_COLORS).forEach((status) => {
      defs
        .append('marker')
        .attr('id', `arrow-${status}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', NODE_RADIUS + 12)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#797876');
    });

    /* Container group for zoom/pan */
    const g = svg.append('g');

    /* Zoom behavior */
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
      });

    svg.call(zoom);

    // Store zoom reference for button controls
    zoomRef.current = zoom;
    (svgRef.current as any).__g = g;

    /* Force simulation */
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(120),
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(NODE_RADIUS + 16))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05));

    simulationRef.current = simulation;

    /* Edges */
    const link = g
      .append('g')
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#797876')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => EDGE_PATTERNS[d.type] || '')
      .attr('marker-end', 'url(#arrow-active)');

    /* Edge labels */
    const edgeLabels = g
      .append('g')
      .selectAll<SVGTextElement, GraphEdge>('text')
      .data(edges)
      .join('text')
      .text((d) => (d.type ?? "").replace(/_/g, ' '))
      .attr('font-size', 9)
      .attr('fill', '#797876')
      .attr('text-anchor', 'middle')
      .attr('dy', -6)
      .style('pointer-events', 'none');

    /* Node groups */
    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    /* Node circles — color by wing or status */
    const nodeColor = (d: GraphNode) => colorByWing ? wingColor(d.wing ?? d.made_by) : STATUS_COLORS[d.status];

    node
      .append('circle')
      .attr('r', NODE_RADIUS)
      .attr('fill', (d) => nodeColor(d))
      .attr('fill-opacity', 0.15)
      .attr('stroke', (d) => nodeColor(d))
      .attr('stroke-width', 2);

    /* Inner dot */
    node
      .append('circle')
      .attr('r', 5)
      .attr('fill', (d) => nodeColor(d));

    /* Labels */
    node
      .append('text')
      .text((d) => (d.title.length > 18 ? d.title.slice(0, 16) + '…' : d.title))
      .attr('dy', NODE_RADIUS + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', 'currentColor')
      .style('pointer-events', 'none');

    /* Click → select */
    node.on('click', (_event, d) => {
      const full = decisions.find((dec) => dec.id === d.id) || null;
      setSelectedNode(full);
    });

    /* Hover effects */
    node
      .on('mouseenter', function () {
        d3.select(this).select('circle').attr('stroke-width', 3);
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle').attr('stroke-width', 2);
      });

    /* Tick */
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!);

      edgeLabels
        .attr('x', (d) => ((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2)
        .attr('y', (d) => ((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [loading, buildGraph, decisions]);

  /* ---- Zoom controls --------------------------------------------- */
  function handleZoom(factor: number) {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const selection = d3.select(svg);
    selection.transition().duration(300).call(zoom.scaleBy, factor);
  }

  function handleFitView() {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const selection = d3.select(svg);
    const { width, height } = svg.getBoundingClientRect();
    selection
      .transition()
      .duration(500)
      .call(
        zoom.transform,
        d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(0.8)
          .translate(-width / 2, -height / 2),
      );
  }

  function handleExpand() {
    setIsExpanded((prev) => !prev);
    setTimeout(() => {
      if (svgRef.current && containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        d3.select(svgRef.current).attr('width', width).attr('height', height);
        handleFitView();
      }
    }, 100);
  }

  function toggleStatus(status: DecisionStatus) {
    setFilterStatus((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  /* ---- Loading & error states ------------------------------------ */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">
            Loading decision graph…
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center">
          <AlertTriangleIcon />
          <h3 className="font-semibold mt-3 mb-1">Failed to load decisions</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Graph area */}
      <div className={`flex-1 relative min-h-[400px] ${isExpanded ? 'fixed inset-0 z-50 bg-[var(--bg-primary)]' : ''}`} ref={containerRef} style={{ background: 'rgba(245,246,248,0.5)' }}>
        {/* Filter bar — full-width header */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 border-b" style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderColor: 'rgba(255,255,255,0.2)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[140px] max-w-[260px]">
              <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search decisions…"
                className="text-xs w-full pl-8 py-1.5 px-3 rounded-lg outline-none"
                style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.4)' }}
              />
            </div>
            <div className="relative">
              <select
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="text-xs appearance-none pr-7 py-1.5 px-3 rounded-lg font-bold cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.4)' }}
              >
                <option value="">All agents</option>
                {allAgents.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-tertiary)]" />
            </div>
            <div className="relative">
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="text-xs appearance-none pr-7 py-1.5 px-3 rounded-lg font-bold cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.4)' }}
              >
                <option value="">All domains</option>
                {allDomains.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-tertiary)]" />
            </div>
            <div className="relative">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="text-xs appearance-none pr-7 py-1.5 px-3 rounded-lg font-bold cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.4)' }}
              >
                <option value="">All categories</option>
                {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-tertiary)]" />
            </div>
            <div className="relative">
              <select
                value={filterWing}
                onChange={(e) => setFilterWing(e.target.value)}
                className="text-xs appearance-none pr-7 py-1.5 px-3 rounded-lg font-bold cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.4)' }}
              >
                <option value="">All wings</option>
                {allWings.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-tertiary)]" />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="btn-secondary text-xs gap-1.5 rounded-lg"
            >
              <Filter size={14} />
              Filters
            </button>
          </div>
          {/* Zoom controls — grouped in header */}
          <div className="flex items-center gap-0 rounded-lg overflow-hidden ml-3 shrink-0" style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.4)' }}>
            <button onClick={() => handleZoom(1.3)} onTouchEnd={(e) => { e.preventDefault(); handleZoom(1.3); }} className="p-2 transition-colors touch-target" style={{ borderRight: '1px solid rgba(255,255,255,0.2)' }} title="Zoom in">
              <ZoomIn size={16} />
            </button>
            <button onClick={() => handleZoom(0.7)} onTouchEnd={(e) => { e.preventDefault(); handleZoom(0.7); }} className="p-2 transition-colors touch-target" style={{ borderRight: '1px solid rgba(255,255,255,0.2)' }} title="Zoom out">
              <ZoomOut size={16} />
            </button>
            <button onClick={handleExpand} onTouchEnd={(e) => { e.preventDefault(); handleExpand(); }} className="p-2 transition-colors touch-target" title={isExpanded ? 'Exit fullscreen' : 'Expand'}>
              {isExpanded ? <X size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="absolute top-[56px] left-4 z-10 p-4 w-72 animate-fade-in rounded-xl shadow-lg" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Filters</span>
              <button onClick={() => setShowFilters(false)} className="btn-ghost p-1">
                <X size={14} />
              </button>
            </div>

            {/* Status toggles */}
            <div className="mb-3">
              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
                Status
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(['active', 'superseded', 'reverted', 'pending'] as DecisionStatus[]).map(
                  (status) => (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={`badge text-xs capitalize transition-opacity ${
                        filterStatus.has(status) ? '' : 'opacity-30'
                      } badge-${status}`}
                    >
                      {status}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Tag filter */}
            <div className="mb-3">
              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
                Tag
              </label>
              <select
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
                className="input text-xs"
              >
                <option value="">All tags</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>

            {/* Wing filter */}
            <div className="mb-3">
              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
                Wing
              </label>
              <select
                value={filterWing}
                onChange={(e) => setFilterWing(e.target.value)}
                className="input text-xs"
              >
                <option value="">All wings</option>
                {allWings.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>

            {/* Color by wing toggle */}
            <div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={colorByWing}
                  onChange={(e) => setColorByWing(e.target.checked)}
                  className="rounded"
                />
                <span className="text-[var(--text-secondary)]">Color by wing</span>
              </label>
            </div>
          </div>
        )}

        {/* Legend — dynamic based on color mode */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)' }}>
          {colorByWing ? (
            allWings.slice(0, 8).map((w) => (
              <div key={w} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: wingColor(w) }} />
                <span>{w}</span>
              </div>
            ))
          ) : (
            Object.entries(STATUS_COLORS).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="capitalize">{status}</span>
              </div>
            ))
          )}
        </div>

        {/* SVG */}
        <svg ref={svgRef} className="w-full h-full" />

        {/* Empty state */}
        {filtered.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <GitBranch
                size={32}
                className="mx-auto mb-2 text-[var(--text-tertiary)]"
              />
              <p className="text-sm text-[var(--text-secondary)]">
                No decisions match current filters
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel — renders below graph on mobile, beside on desktop */}
      {selectedNode && (
        <aside className="w-full md:w-96 shrink-0 border-t md:border-t-0 md:border-l overflow-hidden max-h-[50vh] md:max-h-none animate-slide-in shadow-2xl flex flex-col" style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', zIndex: 20, borderColor: 'rgba(255,255,255,0.3)' }}>
          <div className="p-6 overflow-y-auto flex-1">
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setSelectedNode(null)} className="p-1 rounded-full transition-colors" style={{ background: 'transparent' }}>
                <X size={18} />
              </button>
              <span className={`badge badge-${selectedNode.status} rounded-full text-[10px] font-bold uppercase flex items-center gap-1`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[selectedNode.status] }} />
                {selectedNode.status} Decision
              </span>
            </div>
            <h2 className="text-2xl font-bold leading-tight mb-2">{selectedNode.title}</h2>

            <div className="space-y-4 text-sm">
              {/* Made by + Confidence */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Made by</label>
                  <p className="font-medium">{selectedNode.made_by}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Confidence</label>
                  <p className="font-medium">{(selectedNode as any).confidence ?? 'medium'}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Date</label>
                  <p>{new Date(selectedNode.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Validation</label>
                  <p>{(selectedNode as any).validated_at ? '✅ Validated' : '⏳ Unvalidated'}</p>
                </div>
                {selectedNode.domain && (
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Domain</label>
                    <p className="capitalize">{selectedNode.domain}</p>
                  </div>
                )}
                {selectedNode.category && (
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Category</label>
                    <p className="capitalize">{selectedNode.category}</p>
                  </div>
                )}
              </div>

              {/* Affects */}
              {((selectedNode as any).affects ?? []).length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">Affects</label>
                  <div className="flex flex-wrap gap-1.5">
                    {((selectedNode as any).affects ?? []).map((a: string) => (
                      <span key={a} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-2">
                  Description
                </label>
                <p className="leading-relaxed">{selectedNode.description}</p>
              </div>

              {/* Reasoning */}
              {selectedNode.reasoning && (
                <div className="rounded-xl p-4 border border-primary/10" style={{ background: 'rgba(6,63,249,0.05)' }}>
                  <label className="text-[10px] font-bold text-primary uppercase tracking-wider block mb-2">
                    Reasoning
                  </label>
                  <p className="leading-relaxed italic text-slate-600">{selectedNode.reasoning}</p>
                </div>
              )}

              {/* Tags */}
              {(selectedNode.tags ?? []).length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-2">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedNode.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Alternatives */}
              {(selectedNode.alternatives ?? []).length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-2">
                    Alternatives Considered
                  </label>
                  <ul className="list-disc pl-4 space-y-1">
                    {(selectedNode.alternatives ?? []).map((alt, i) => (
                      <li key={i}>{alt}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Assumptions */}
              {(selectedNode.assumptions ?? []).length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-2">
                    Assumptions
                  </label>
                  <ul className="list-disc pl-4 space-y-1">
                    {(selectedNode.assumptions ?? []).map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Linked PRs */}
              <LinkedPRs decisionId={selectedNode.id} />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

/* Small inline icon */
function AlertTriangleIcon() {
  return (
    <div className="w-10 h-10 mx-auto rounded-full bg-status-reverted/15 flex items-center justify-center">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#DC2626"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </div>
  );
}
