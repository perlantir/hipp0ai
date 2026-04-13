import React, { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react';
import { ThemeContext, useTheme, useThemeProvider } from './theme';

/* ------------------------------------------------------------------ */
/*  Error Boundary                                                     */
/* ------------------------------------------------------------------ */

class ErrorBoundary extends React.Component<
  { children: ReactNode; viewKey?: string },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: { viewKey?: string }) {
    if (prevProps.viewKey !== this.props.viewKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-lg font-medium mb-2">Something went wrong</p>
          <p className="text-sm mb-4">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-[#063ff9] text-white rounded-lg text-sm hover:bg-[#0534d4]"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import {
  GitBranch,
  Clock,
  AlertTriangle,
  Columns2,
  Search as SearchIcon,
  Zap,
  History,
  Bell,
  BarChart3,
  Upload,
  Settings,
  Radio,
  Menu,
  X,
  ClipboardCheck,
  Activity,
  CreditCard,
  Crown,
  Sun,
  Moon,
  ClipboardList,
  Target,
  Users,
  Sparkles,
  Lightbulb,
  Share2,
  FlaskConical,
  Gauge,
  HeartPulse,
  TrendingUp,
  Waypoints,
  Camera,
  Wand2,
  MessageSquare,
} from 'lucide-react';
import { DecisionGraph } from './components/DecisionGraph';
import { Timeline } from './components/Timeline';
import { Contradictions } from './components/Contradictions';
import { ContextComparison } from './components/ContextComparison';
import { Search } from './components/Search';
import { ImpactAnalysis } from './components/ImpactAnalysis';
import { SessionHistory } from './components/SessionHistory';
import { NotificationFeed } from './components/NotificationFeed';
import { ProjectStats } from './components/ProjectStats';
import { Wizard } from './components/Wizard';
import { Import } from './components/Import';
import { Connectors } from './components/Connectors';
import { Webhooks } from './components/Webhooks';
import { TimeTravelView } from './components/TimeTravelView';
import { CompileTester } from './components/CompileTester';
import { AskAnything } from './components/AskAnything';
import { TokenUsage } from './components/TokenUsage';
import { ConnectionStatus } from './components/ConnectionStatus';
import { CommandPalette } from './components/CommandPalette';
import { Pricing } from './components/Pricing';
import { BillingSettings } from './components/BillingSettings';
import { Playground } from './components/Playground';
import { PlaygroundSuperBrain } from './components/PlaygroundSuperBrain';
import { ImportWizard } from './components/ImportWizard';
import { CollabRoom } from './components/CollabRoom';
import { ReviewQueue } from './components/ReviewQueue';
import { MonitoringCards } from './components/MonitoringCards';
import { ToastProvider } from './components/Toast';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { OutcomeHistory } from './components/OutcomeHistory';
import { HermesAgents } from './components/HermesAgents';
import { HermesSetup } from './components/HermesSetup';
import { Pulse } from './components/Pulse';
import { Login } from './components/Login';
import { SettingsView } from './components/Settings';
import { ChatView } from './components/Chat/ChatView';

import { EvolutionProposals } from './components/EvolutionProposals';
import { WhatIfSimulator } from './components/WhatIfSimulator';
import { LiveSessions } from './components/LiveSessions';
import { TeamScore } from './components/TeamScore';
import { Policies } from './components/Policies';
import { Violations } from './components/Violations';
import { WeeklyDigest } from './components/WeeklyDigest';
import { WingView } from './components/WingView';
import { CaptureHistory } from './components/CaptureHistory';
import { CommunityInsights } from './components/CommunityInsights';
import { AgentSkills } from './components/AgentSkills';
import { KnowledgeInsights } from './components/KnowledgeInsights';
import { TeamProcedures } from './components/TeamProcedures';
import { SharedPatterns } from './components/SharedPatterns';
import { Experiments } from './components/Experiments';
import { ImpactPrediction } from './components/ImpactPrediction';
import { KnowledgeBranches } from './components/KnowledgeBranches';
import { TeamHealth } from './components/TeamHealth';
import { Trends } from './components/Trends';
import { LiveEvents } from './components/LiveEvents';
import { Traces } from './components/Traces';

import { useApi } from './hooks/useApi';
import { useWebSocket } from './hooks/useWebSocket';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

/* ------------------------------------------------------------------ */
/*  Project context                                                    */
/* ------------------------------------------------------------------ */

interface ProjectContextValue {
  projectId: string;
  setProjectId: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  projectId: 'default',
  setProjectId: () => {},
});

export function useProject() {
  return useContext(ProjectContext);
}

/* ------------------------------------------------------------------ */
/*  Views                                                              */
/* ------------------------------------------------------------------ */

type View =
  | 'pulse'
  | 'graph'
  | 'hermes-agents'
  | 'hermes-setup'
  | 'timeline'
  | 'contradictions'
  | 'context'
  | 'search'
  | 'impact'
  | 'sessions'
  | 'notifications'
  | 'stats'
  | 'import'
  | 'connectors'
  | 'webhooks'
  | 'timetravel'
  | 'wizard'
  | 'compile-tester'
  | 'ask-anything'
  | 'token-usage'
  | 'outcomes'
  | 'pricing'
  | 'billing'
  | 'playground'
  | 'review-queue'
  | 'policies'
  | 'violations'
  | 'digest'
  | 'evolution'
  | 'whatif'
  | 'live-tasks'
  | 'team-score'
  | 'import-wizard'
  | 'collab-room'
  | 'wings'
  | 'captures'
  | 'community-insights'
  | 'agent-skills'
  | 'insights'
  | 'procedures'
  | 'shared-patterns'
  | 'experiments'
  | 'impact-prediction'
  | 'branches'
  | 'team-health'
  | 'trends'
  | 'live-events'
  | 'traces'
  | 'settings'
  | 'chat';

type NavGroup =
  | 'memory'
  | 'intelligence'
  | 'operations'
  | 'labs';

interface NavItem {
  id: View;
  label: string;
  icon: ReactNode;
  badge?: number | null;
  group: NavGroup;
}

function isPlaygroundRoute(): boolean {
  // Only intercept /playground path for unauthenticated full-page access.
  // Hash-based #playground is handled by the normal ViewContent switch inside the dashboard.
  return window.location.pathname === '/playground';
}

function getViewFromHash(): View {
  const hash = window.location.hash.replace('#', '') as View;
  const all: View[] = [
    'pulse','graph','hermes-agents','hermes-setup','timeline','contradictions','context','search','impact','sessions','notifications','stats','outcomes',
    'import','connectors','webhooks','timetravel','compile-tester','ask-anything','token-usage','pricing','billing',
    'playground','review-queue','policies','violations','digest','evolution','whatif','live-tasks','team-score',
    'import-wizard','collab-room','wings',
    'captures','community-insights','agent-skills','insights','procedures','shared-patterns','experiments',
    'impact-prediction','branches','team-health','trends','live-events','traces','settings','chat',
  ];

  if (all.includes(hash)) return hash;
  return 'chat';
}

/* ------------------------------------------------------------------ */
/*  View renderer                                                      */
/* ------------------------------------------------------------------ */

function PlaygroundWrapper() {
  const [classic, setClassic] = React.useState(false);
  if (classic) return <><Playground /><div style={{textAlign:'center',marginTop:16}}><button onClick={()=>setClassic(false)} style={{background:'none',border:'none',color:'#6b7280',cursor:'pointer',fontSize:13}}>Back to Super Brain →</button></div></>;
  return <PlaygroundSuperBrain onClassicMode={() => setClassic(true)} />;
}

function ViewContent({ view }: { view: View }) {
  switch (view) {
    case 'pulse': return <Pulse />;
    case 'graph': return <DecisionGraph />;
    case 'hermes-agents': return <HermesAgents />;
    case 'hermes-setup': return <HermesSetup />;
    case 'timeline': return <Timeline />;
    case 'contradictions': return <Contradictions />;
    case 'context': return <ContextComparison />;
    case 'search': return <Search />;
    case 'impact': return <ImpactAnalysis />;
    case 'sessions': return <SessionHistory />;
    case 'notifications': return <NotificationFeed />;
    case 'stats': return <ProjectStats />;
    case 'outcomes': return <OutcomeHistory />;
    case 'import': return <Import />;
    case 'connectors': return <Connectors />;
    case 'webhooks': return <Webhooks />;
    case 'timetravel': return <TimeTravelView />;
    case 'compile-tester': return <CompileTester />;
    case 'ask-anything': return <AskAnything />;
    case 'token-usage': return <TokenUsage />;
    case 'pricing': return <Pricing />;
    case 'billing': return <BillingSettings />;
    case 'playground': return <PlaygroundWrapper />;
    case 'review-queue': return <ReviewQueue />;
    case 'policies': return <Policies />;
    case 'violations': return <Violations />;
    case 'digest': return <WeeklyDigest />;
    case 'evolution': return <EvolutionProposals />;
    case 'whatif': return <WhatIfSimulator />;
    case 'live-tasks': return <LiveSessions />;
    case 'team-score': return <TeamScore />;
    case 'import-wizard': return <ImportWizard />;
    case 'collab-room': return <CollabRoom />;
    case 'wings': return <WingView />;
    case 'captures': return <CaptureHistory />;
    case 'community-insights': return <CommunityInsights />;
    case 'agent-skills': return <AgentSkills />;
    case 'insights': return <KnowledgeInsights />;
    case 'procedures': return <TeamProcedures />;
    case 'shared-patterns': return <SharedPatterns />;
    case 'experiments': return <Experiments />;
    case 'impact-prediction': return <ImpactPrediction />;
    case 'branches': return <KnowledgeBranches />;
    case 'team-health': return <TeamHealth />;
    case 'trends': return <Trends />;
    case 'live-events': return <LiveEvents />;
    case 'traces': return <Traces />;
    case 'settings': return <SettingsView />;
    case 'chat': return <ChatView />;

    default: return <ChatView />;
  }
}

/* ------------------------------------------------------------------ */
/*  Nav Item Component                                                 */
/* ------------------------------------------------------------------ */

function NavItemButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={`nav-item w-full text-left ${active ? 'active' : ''}`}
    >
      <span className="shrink-0">{item.icon}</span>
      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
      {!collapsed && item.badge != null && item.badge > 0 && (
        <span className="nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme Toggle Button                                                */
/* ------------------------------------------------------------------ */

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      className="p-2 rounded-md transition-colors duration-150"
      style={{ color: 'var(--text-secondary)' }}
    >
      {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar Content (shared between mobile menu and desktop sidebar)   */
/* ------------------------------------------------------------------ */

const GROUP_ORDER: Array<{ key: NavGroup; label: string }> = [
  { key: 'memory', label: '' },
  { key: 'labs', label: 'Labs' },
];

function SidebarContent({
  navItems,
  view,
  collapsed,
  onNavigate,
}: {
  navItems: NavItem[];
  view: View;
  collapsed?: boolean;
  onNavigate: (v: View) => void;
}) {
  const groups = GROUP_ORDER.map(({ key, label }) => ({
    key,
    label,
    items: navItems.filter((n) => n.group === key),
  }));

  return (
    <>
      {/* Logo — sourced from public/images/hipp0-logo.png, same asset as marketing site */}
      <div className="mb-8 flex items-center px-4 pt-6">
        <img
          src="/images/hipp0-logo.png"
          alt="Hipp0"
          className={collapsed ? 'h-10 w-auto' : 'h-14 w-auto'}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group, gi) => {
          if (group.items.length === 0) return null;
          return (
            <div key={group.key}>
              {gi > 0 && <div className="nav-divider" />}
              {!collapsed && group.label && (
                <div
                  className="px-3 pt-3 pb-1.5 text-2xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-sidebar)', opacity: 0.6 }}
                >
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItemButton
                    key={item.id}
                    item={item}
                    active={view === item.id}
                    collapsed={collapsed}
                    onClick={() => onNavigate(item.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {!collapsed && (
        <div className="mt-auto pt-6 border-t border-white/5 px-3 pb-4 space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-slate-500 font-mono">v0.3.2</span>
            <ThemeToggle />
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const { get } = useApi();
  const { connected } = useWebSocket();
  const themeCtx = useThemeProvider();

  const [view, setView] = useState<View>(getViewFromHash);
  const [projectId, setProjectId] = useState('default');
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // First-run detection
  const [showWizard, setShowWizard] = useState(false);
  const [projectsChecked, setProjectsChecked] = useState(false);

  // Badge counts
  const [unresolvedCount, setUnresolvedCount] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  // Keyboard shortcuts modal
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Auth gating — if no API key in localStorage, show Login screen
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try { return !!localStorage.getItem('hipp0_api_key'); } catch { return false; }
  });
  const [loginError, setLoginError] = useState<string | null>(null);

  async function handleLogin(apiKey: string) {
    setLoginError(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        localStorage.setItem('hipp0_api_key', apiKey);
        setIsAuthenticated(true);
      } else {
        setLoginError('Invalid API key — check your key and try again');
      }
    } catch {
      setLoginError('Invalid API key — check your key and try again');
    }
  }

  // Labs group is gated: users who want to see every experimental / niche
  // view can opt in via localStorage.setItem('hipp0_labs', 'true'). Default
  // off so first-time users see a focused 10-item sidebar centered on the
  // persistent-multi-agent story (Pulse → Agents → Decisions).
  const labsEnabled = typeof window !== 'undefined'
    && window.localStorage?.getItem('hipp0_labs') === 'true';

  // Build nav items — 5 focused primary items + optional Labs (gated).
  const navItems: NavItem[] = [
    // ---- Primary (always visible) ---------------------------------
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={18} />, group: 'memory' },
    { id: 'pulse', label: 'Pulse', icon: <Activity size={18} />, group: 'memory' },
    { id: 'hermes-agents', label: 'Agents', icon: <Users size={18} />, group: 'memory' },
    { id: 'compile-tester', label: 'Compile', icon: <ClipboardCheck size={18} />, group: 'memory' },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} />, group: 'memory' },

    // ---- Labs — gated behind localStorage.setItem('hipp0_labs', 'true')
    ...(labsEnabled ? [
      { id: 'graph' as View,              label: 'Decisions Graph',     icon: <GitBranch size={18} />,     group: 'labs' as NavGroup },
      { id: 'timeline' as View,           label: 'Timeline',            icon: <Clock size={18} />,         group: 'labs' as NavGroup },
      { id: 'search' as View,             label: 'Search',              icon: <SearchIcon size={18} />,    group: 'labs' as NavGroup },
      { id: 'contradictions' as View,     label: 'Contradictions',      icon: <AlertTriangle size={18} />, badge: unresolvedCount, group: 'labs' as NavGroup },
      { id: 'insights' as View,           label: 'Insights',            icon: <Lightbulb size={18} />,     group: 'labs' as NavGroup },
      { id: 'playground' as View,         label: 'Playground',          icon: <Zap size={18} />,           group: 'labs' as NavGroup },
      { id: 'connectors' as View,         label: 'Connectors',          icon: <Settings size={18} />,      group: 'labs' as NavGroup },
      { id: 'hermes-setup' as View,       label: 'Hermes Setup',        icon: <Settings size={18} />,      group: 'labs' as NavGroup },
      { id: 'context' as View,            label: 'Context Compare',     icon: <Columns2 size={18} />,      group: 'labs' as NavGroup },
      { id: 'outcomes' as View,           label: 'Outcomes',            icon: <Target size={18} />,        group: 'labs' as NavGroup },
      { id: 'ask-anything' as View,       label: 'Ask Anything',        icon: <Activity size={18} />,      group: 'labs' as NavGroup },
      { id: 'import-wizard' as View,      label: 'Import',              icon: <Upload size={18} />,        group: 'labs' as NavGroup },
      { id: 'live-events' as View,        label: 'Live Events',         icon: <Radio size={18} />,         group: 'labs' as NavGroup },
      { id: 'digest' as View,             label: 'Weekly Digest',       icon: <BarChart3 size={18} />,     group: 'labs' as NavGroup },
      { id: 'agent-skills' as View,       label: 'Agent Skills',        icon: <Sparkles size={18} />,      group: 'labs' as NavGroup },
      { id: 'procedures' as View,         label: 'Team Procedures',     icon: <ClipboardList size={18} />, group: 'labs' as NavGroup },
      { id: 'evolution' as View,          label: 'Evolution',           icon: <Zap size={18} />,           group: 'labs' as NavGroup },
      { id: 'community-insights' as View, label: 'Community Insights',  icon: <Lightbulb size={18} />,     group: 'labs' as NavGroup },
      { id: 'shared-patterns' as View,    label: 'Shared Patterns',     icon: <Share2 size={18} />,        group: 'labs' as NavGroup },
      { id: 'wings' as View,              label: 'Wings',               icon: <Users size={18} />,         group: 'labs' as NavGroup },
      { id: 'team-score' as View,         label: 'Team Score',          icon: <Users size={18} />,         group: 'labs' as NavGroup },
      { id: 'team-health' as View,        label: 'Team Health',         icon: <HeartPulse size={18} />,    group: 'labs' as NavGroup },
      { id: 'experiments' as View,        label: 'A/B Experiments',     icon: <FlaskConical size={18} />,  group: 'labs' as NavGroup },
      { id: 'whatif' as View,             label: 'What-If Simulator',   icon: <Zap size={18} />,           group: 'labs' as NavGroup },
      { id: 'branches' as View,           label: 'Knowledge Branches',  icon: <GitBranch size={18} />,     group: 'labs' as NavGroup },
      { id: 'impact-prediction' as View,  label: 'Impact Prediction',   icon: <Gauge size={18} />,         group: 'labs' as NavGroup },
      { id: 'impact' as View,             label: 'Impact Analysis',     icon: <Zap size={18} />,           group: 'labs' as NavGroup },
      { id: 'traces' as View,             label: 'Traces',              icon: <Waypoints size={18} />,     group: 'labs' as NavGroup },
      { id: 'timetravel' as View,         label: 'Time Travel',         icon: <Clock size={18} />,         group: 'labs' as NavGroup },
      { id: 'trends' as View,             label: 'Trends',              icon: <TrendingUp size={18} />,    group: 'labs' as NavGroup },
      { id: 'token-usage' as View,        label: 'Token Usage',         icon: <BarChart3 size={18} />,     group: 'labs' as NavGroup },
      { id: 'stats' as View,              label: 'Health',              icon: <BarChart3 size={18} />,     group: 'labs' as NavGroup },
      { id: 'live-tasks' as View,         label: 'Live Sessions',       icon: <Activity size={18} />,      group: 'labs' as NavGroup },
      { id: 'sessions' as View,           label: 'Sessions',            icon: <History size={18} />,       group: 'labs' as NavGroup },
      { id: 'captures' as View,           label: 'Captures',            icon: <Camera size={18} />,        group: 'labs' as NavGroup },
      { id: 'webhooks' as View,           label: 'Webhooks',            icon: <Radio size={18} />,         group: 'labs' as NavGroup },
      { id: 'collab-room' as View,        label: 'Collab Room',         icon: <Radio size={18} />,         group: 'labs' as NavGroup },
      { id: 'review-queue' as View,       label: 'Review Queue',        icon: <ClipboardList size={18} />, badge: reviewCount, group: 'labs' as NavGroup },
      { id: 'policies' as View,           label: 'Policies',            icon: <ClipboardCheck size={18} />,group: 'labs' as NavGroup },
      { id: 'violations' as View,         label: 'Violations',          icon: <AlertTriangle size={18} />, group: 'labs' as NavGroup },
      { id: 'notifications' as View,      label: 'Alerts',              icon: <Bell size={18} />,          group: 'labs' as NavGroup },
      { id: 'import' as View,             label: 'Import (legacy)',     icon: <Upload size={18} />,        group: 'labs' as NavGroup },
    ] : []),
  ];

  // Command palette items
  const commandItems = navItems.map((item, i) => ({
    id: item.id,
    label: item.label,
    group: item.group,
    shortcut: i < 9 ? String(i + 1) : undefined,
  }));

  /* ---- Check for first run -------------------------------------- */
  useEffect(() => {
    // First-ever visit → show the setup wizard even if a demo project exists.
    // After completing or skipping, set hipp0_wizard_completed so it never
    // reappears automatically. Users can re-run it from the menu later.
    const wizardCompleted = typeof window !== 'undefined'
      && window.localStorage?.getItem('hipp0_wizard_completed') === 'true';

    get<Array<{ id: string }>>('/api/projects')
      .then((projects) => {
        const noProjects = Array.isArray(projects) && projects.length === 0;
        if (noProjects || !wizardCompleted) {
          setShowWizard(true);
        }
        if (Array.isArray(projects) && projects.length > 0) {
          if (projectId === 'default' && projects[0]?.id) {
            setProjectId(projects[0].id);
          }
        }
        setProjectsChecked(true);
      })
      .catch(() => setProjectsChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Fetch unresolved contradiction count + review queue ------- */
  useEffect(() => {
    if (!projectsChecked || showWizard || projectId === 'default') return;
    let cancelled = false;
    get<Array<{ id: string }>>(`/api/projects/${projectId}/contradictions?status=unresolved`)
      .then((data) => {
        if (!cancelled) setUnresolvedCount(Array.isArray(data) ? data.length : null);
      })
      .catch(() => { if (!cancelled) setUnresolvedCount(null); });
    get<Array<{ id: string }>>(`/api/projects/${projectId}/review-queue`)
      .then((data) => {
        if (!cancelled) setReviewCount(Array.isArray(data) ? data.length : null);
      })
      .catch(() => { if (!cancelled) setReviewCount(null); });
    return () => { cancelled = true; };
  }, [get, projectId, projectsChecked, showWizard]);

  /* ---- Hash sync ------------------------------------------------ */
  useEffect(() => {
    function onHash() { setView(getViewFromHash()); }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* ---- Navigate ------------------------------------------------- */
  const navigate = useCallback((v: View) => {
    window.location.hash = v;
    setView(v);
    setMenuOpen(false);
  }, []);

  // Keyboard shortcuts (after navigate is defined)
  useKeyboardShortcuts({
    onCommandPalette: () => setCommandPaletteOpen((o) => !o),
    onEscape: () => {
      setCommandPaletteOpen(false);
      setMenuOpen(false);
      setShowShortcuts(false);
    },
    onNavigate: (index) => {
      if (index < navItems.length) navigate(navItems[index].id);
    },
    onHelp: () => setShowShortcuts((o) => !o),
  });

  /* ---- Touch gestures: swipe from left edge to open menu -------- */
  useEffect(() => {
    let startX = 0;
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onTouchEnd = (e: TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      if (startX < 20 && endX - startX > 60) setMenuOpen(true);
    };
    document.addEventListener('touchstart', onTouchStart);
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  /* ---- Wizard complete ----------------------------------------- */
  function handleWizardComplete(newProjectId: string) {
    try { window.localStorage?.setItem('hipp0_wizard_completed', 'true'); } catch { /* non-fatal */ }
    setProjectId(newProjectId);
    setShowWizard(false);
    navigate('chat');
  }

  /* ---- Wizard skip --------------------------------------------- */
  function handleWizardSkip() {
    try { window.localStorage?.setItem('hipp0_wizard_completed', 'true'); } catch { /* non-fatal */ }
    setShowWizard(false);
  }

  /* ---- Playground: public route, bypass login gate --------------- */
  const [isPlayground, setIsPlayground] = useState(isPlaygroundRoute);
  useEffect(() => {
    function checkPlayground() { setIsPlayground(isPlaygroundRoute()); }
    window.addEventListener('hashchange', checkPlayground);
    window.addEventListener('popstate', checkPlayground);
    return () => {
      window.removeEventListener('hashchange', checkPlayground);
      window.removeEventListener('popstate', checkPlayground);
    };
  }, []);

  if (isPlayground) {
    return (
      <ThemeContext.Provider value={themeCtx}>
        <Playground />
      </ThemeContext.Provider>
    );
  }

  /* ---- Login gate ------------------------------------------------ */
  if (!isAuthenticated) {
    return (
      <ThemeContext.Provider value={themeCtx}>
        <Login onLogin={handleLogin} error={loginError} />
      </ThemeContext.Provider>
    );
  }

  /* ---- Loading -------------------------------------------------- */
  if (!projectsChecked) {
    return (
      <ThemeContext.Provider value={themeCtx}>
      <ProjectContext.Provider value={{ projectId, setProjectId }}>
        <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
          <img src="/images/hipp0-logo.png" alt="Hipp0" className="h-16 w-auto" />
        </div>
      </ProjectContext.Provider>
      </ThemeContext.Provider>
    );
  }

  /* ---- Wizard -------------------------------------------------- */
  if (showWizard) {
    return (
      <ThemeContext.Provider value={themeCtx}>
      <ProjectContext.Provider value={{ projectId, setProjectId }}>
        <Wizard onComplete={handleWizardComplete} onSkip={handleWizardSkip} />
      </ProjectContext.Provider>
      </ThemeContext.Provider>
    );
  }

  /* ---- Main dashboard ------------------------------------------ */
  return (
    <ThemeContext.Provider value={themeCtx}>
    <ProjectContext.Provider value={{ projectId, setProjectId }}>
    <ToastProvider>
      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}

      {/* Command Palette */}
      <CommandPalette
        items={commandItems}
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={(id) => navigate(id as View)}
      />

      {/* Mobile top bar */}
      <header
        className="sticky top-0 z-30 flex items-center h-14 px-4 border-b md:hidden top-bar"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-light)' }}
      >
        <button onClick={() => setMenuOpen(true)} className="p-2 -ml-2 touch-target">
          <Menu className="w-5 h-5" style={{ color: 'var(--text-primary)' }} />
        </button>
        <img src="/images/hipp0-logo.png" alt="Hipp0" className="ml-3 h-8 w-auto flex-1 object-contain object-left" />
        <ConnectionStatus status={connected} />
        <ThemeToggle />
      </header>

      {/* Mobile overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Mobile slide-over menu */}
      <nav
        className={`fixed inset-y-0 left-0 z-50 w-3/4 max-w-[320px] transform transition-transform duration-[250ms] ease-out md:hidden flex flex-col ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'var(--bg-sidebar)' }}
      >
        <SidebarContent navItems={navItems} view={view} onNavigate={navigate} />
      </nav>

      <div className="flex h-screen overflow-hidden">
        {/* Swarm Background Orbs */}
        <div className="swarm-bg-orb swarm-bg-orb-1" />
        <div className="swarm-bg-orb swarm-bg-orb-2" />
        <div className="swarm-bg-orb swarm-bg-orb-3" />

        {/* Desktop/Tablet sidebar */}
        <aside className="hidden md:flex md:flex-col shrink-0 sidebar">
          <SidebarContent navItems={navItems} view={view} onNavigate={navigate} />
        </aside>

        {/* Main content */}
        <main
          className="flex-1 overflow-y-auto md:ml-[256px]"
          style={{ background: 'var(--bg-primary)' }}
        >
          {/* Desktop top bar */}
          <div
            className="hidden md:flex items-center justify-end gap-4 px-8 h-14 sticky top-0 z-30"
            style={{ background: 'rgba(245,246,248,0.6)', backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255,255,255,0.2)' }}
          >
            <ConnectionStatus status={connected} />
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="command-palette-trigger"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-light)',
                background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12,
                color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)',
              }}
            >
              <SearchIcon size={12} />
              <span>Search</span>
              <kbd style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 4px',
                background: 'var(--bg-secondary)', borderRadius: 3,
                border: '1px solid var(--border-light)',
              }}>
                Ctrl+K
              </kbd>
            </button>
          </div>

          {view === 'stats' && (
            <div className="max-w-5xl mx-auto px-6 pt-6">
              <MonitoringCards onNavigate={(v) => navigate(v as View)} />
            </div>
          )}

          <ErrorBoundary viewKey={view}>
            <div className="page-enter">
              <ViewContent view={view} />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </ToastProvider>
    </ProjectContext.Provider>
    </ThemeContext.Provider>
  );
}
