import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, Circle, X, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

const STORAGE_KEY = 'hipp0_onboarding_dismissed';
const WHATIF_STORAGE_KEY = 'hipp0_onboarding_whatif_tried';
const ROLE_DIFF_STORAGE_KEY = 'hipp0_onboarding_role_diff_tried';

interface OnboardingChecklistProps {
  onNavigate: (view: string) => void;
  /**
   * Signal from the parent that the active view changed, so the checklist
   * can re-run its status checks. Pass the current view id.
   */
  viewKey?: string;
}

interface Step {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action: () => void;
}

type ApiGet = <T>(path: string) => Promise<T>;

async function safeGet<T>(get: ApiGet, path: string, fallback: T): Promise<T> {
  try {
    return await get<T>(path);
  } catch {
    return fallback;
  }
}

async function runChecks(
  get: ApiGet,
  projectId: string | null,
): Promise<{
  hasProject: boolean;
  hasDecision: boolean;
  hasCompile: boolean;
  hasTwoAgents: boolean;
  hasWhatIf: boolean;
}> {
  // 1. Projects
  const projects = await safeGet<Array<{ id: string }>>(get, '/api/projects', []);
  const hasProject = Array.isArray(projects) && projects.length > 0;

  const activeProjectId =
    projectId && projectId !== 'default'
      ? projectId
      : hasProject
        ? projects[0].id
        : null;

  if (!activeProjectId) {
    return {
      hasProject,
      hasDecision: false,
      hasCompile: false,
      hasTwoAgents: false,
      hasWhatIf: localStorage.getItem(WHATIF_STORAGE_KEY) === 'true',
    };
  }

  // 2. Decisions
  const decisions = await safeGet<Array<{ id: string }>>(
    get,
    `/api/projects/${activeProjectId}/decisions?limit=1`,
    [],
  );
  const hasDecision = Array.isArray(decisions) && decisions.length > 0;

  // 3 & 4. Stats returns compile counts (via feedback.per_compilation) and
  //       decisions_per_agent (non-empty rows imply compiles exist per agent).
  const stats = await safeGet<{
    total_compiles?: number;
    feedback?: { per_compilation?: number };
    decisions_per_agent?: Array<{ agent: string; count: number }>;
  }>(get, `/api/projects/${activeProjectId}/stats`, {});

  // Usage endpoint exposes `total_compiles` directly.
  const usage = await safeGet<{ total_compiles?: number }>(
    get,
    `/api/projects/${activeProjectId}/usage`,
    {},
  );

  const totalCompiles = usage.total_compiles ?? stats.total_compiles ?? 0;
  const hasCompile = totalCompiles > 0;

  // Role differentiation: the user has actually opened the Context Comparison
  // view and clicked Compare. Flag is set from ContextComparison.tsx on a
  // successful compare. Fall back to the stats-based heuristic for users who
  // explored the feature before the flag existed.
  const roleDiffFlag = localStorage.getItem(ROLE_DIFF_STORAGE_KEY) === 'true';
  const perAgent = Array.isArray(stats.decisions_per_agent)
    ? stats.decisions_per_agent.filter((a) => (a.count ?? 0) > 0).length
    : 0;
  const hasTwoAgents = roleDiffFlag || (hasCompile && perAgent >= 2);

  // 5. What-If — no persistent server table, use localStorage flag set when
  //    the user clicks the step (fallback) or when the What-If simulator
  //    writes the flag on successful run.
  const hasWhatIf = localStorage.getItem(WHATIF_STORAGE_KEY) === 'true';

  return { hasProject, hasDecision, hasCompile, hasTwoAgents, hasWhatIf };
}

export function OnboardingChecklist({ onNavigate, viewKey }: OnboardingChecklistProps) {
  const { get } = useApi();
  const { projectId } = useProject();

  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true',
  );
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const [status, setStatus] = useState({
    hasProject: false,
    hasDecision: false,
    hasCompile: false,
    hasTwoAgents: false,
    hasWhatIf: false,
  });

  // Trigger slide-in animation shortly after mount.
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  // Run checks on mount and after view changes.
  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;

    async function run() {
      const result = await runChecks(get, projectId);
      if (!cancelled) setStatus(result);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [dismissed, get, projectId, viewKey]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  }, []);

  const markWhatIfTried = useCallback(() => {
    localStorage.setItem(WHATIF_STORAGE_KEY, 'true');
    setStatus((s) => ({ ...s, hasWhatIf: true }));
  }, []);

  const steps: Step[] = [
    {
      id: 'project',
      title: 'Create your project',
      description: 'Set up your first Hipp0 project to get started.',
      completed: status.hasProject,
      action: () => onNavigate('wizard'),
    },
    {
      id: 'decision',
      title: 'Record your first decision',
      description: 'Capture a decision so Hipp0 can reason over it.',
      completed: status.hasDecision,
      action: () => {
        try {
          sessionStorage.setItem('hipp0_open_new_decision', 'true');
        } catch {
          /* ignore */
        }
        onNavigate('graph');
      },
    },
    {
      id: 'compile',
      title: 'Run your first compile',
      description: 'Try compiling context for an agent in the Playground.',
      completed: status.hasCompile,
      action: () => onNavigate('playground'),
    },
    {
      id: 'roles',
      title: 'See role differentiation',
      description: 'Compare how context differs across two agents.',
      completed: status.hasTwoAgents,
      action: () => onNavigate('context'),
    },
    {
      id: 'whatif',
      title: 'Try the What-If simulator',
      description: 'See how a proposed decision change ripples out.',
      completed: status.hasWhatIf,
      action: () => {
        markWhatIfTried();
        onNavigate('whatif');
      },
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const allComplete = completedCount === steps.length;
  const firstIncompleteIndex = steps.findIndex((s) => !s.completed);

  // Celebration + auto-dismiss when all steps complete.
  const autoDismissRef = useRef<number | null>(null);
  useEffect(() => {
    if (dismissed) return;
    if (allComplete && !celebrating) {
      setCelebrating(true);
      autoDismissRef.current = window.setTimeout(() => {
        handleDismiss();
      }, 5000);
    }
    return () => {
      if (autoDismissRef.current !== null) {
        window.clearTimeout(autoDismissRef.current);
        autoDismissRef.current = null;
      }
    };
  }, [allComplete, celebrating, dismissed, handleDismiss]);

  if (dismissed) return null;

  // Collapsed pill view
  if (collapsed) {
    return (
      <button
        type="button"
        className={`onboarding-pill ${mounted ? 'onboarding-slide-in' : ''}`}
        onClick={() => setCollapsed(false)}
        title="Expand onboarding checklist"
      >
        <Sparkles size={14} />
        <span>
          Onboarding {completedCount}/{steps.length}
        </span>
        <ChevronUp size={14} />
      </button>
    );
  }

  return (
    <div
      className={`onboarding-float ${mounted ? 'onboarding-slide-in' : ''}`}
      role="region"
      aria-label="Onboarding checklist"
    >
      <div className="onboarding-header">
        <div>
          <h3 className="onboarding-title">
            {celebrating ? "You're all set!" : 'Get started with Hipp0'}
          </h3>
          <p className="onboarding-subtitle">
            {celebrating
              ? 'Dismissing in a moment…'
              : `${completedCount} of ${steps.length} steps complete`}
          </p>
        </div>
        <div className="onboarding-actions">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="onboarding-icon-btn"
            title="Minimize"
            aria-label="Minimize onboarding checklist"
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="onboarding-icon-btn"
            title="Dismiss"
            aria-label="Dismiss onboarding checklist"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="onboarding-progress-track">
        <div
          className="onboarding-progress-fill"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      {celebrating ? (
        <div className="onboarding-celebrate">
          <Sparkles size={28} style={{ color: 'var(--accent-primary)' }} />
          <p className="onboarding-celebrate-title">You&apos;re all set! 🎉</p>
          <p className="onboarding-celebrate-sub">
            You&apos;ve completed every onboarding step.
          </p>
        </div>
      ) : (
        <ul className="onboarding-list">
          {steps.map((step, i) => {
            const isCurrent = i === firstIncompleteIndex;
            return (
              <li
                key={step.id}
                className={`onboarding-step ${step.completed ? 'completed' : ''} ${
                  isCurrent ? 'current' : ''
                }`}
              >
                <button
                  type="button"
                  className="onboarding-step-btn"
                  onClick={step.action}
                  disabled={step.completed}
                >
                  <span className="onboarding-step-icon">
                    {step.completed ? (
                      <CheckCircle2
                        size={18}
                        style={{ color: 'var(--accent-success)' }}
                      />
                    ) : (
                      <Circle
                        size={18}
                        style={{
                          color: isCurrent
                            ? 'var(--accent-primary)'
                            : 'var(--text-tertiary)',
                        }}
                      />
                    )}
                  </span>
                  <span
                    className="onboarding-step-body"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <span
                      className="onboarding-step-title"
                      style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: 'var(--text-primary)' }}
                    >
                      {step.title}
                    </span>
                    <span
                      className="onboarding-step-desc"
                      style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4, color: 'var(--text-secondary)' }}
                    >
                      {step.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
