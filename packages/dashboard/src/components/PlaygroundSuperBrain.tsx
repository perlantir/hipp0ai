/**
 * Super Brain Playground — interactive step-by-step agent simulation.
 *
 * 100% client-side, zero API/LLM calls. Uses hardcoded demo scenarios.
 * Cyanic Swarm #063ff9 accents, glassmorphism cards, smooth animations.
 *
 * Flow: Hero → Task Input → Team Plan → Step Simulation → Completion
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { findScenario, type DemoScenario, type DemoStep } from '../data/demo-scenarios';

// -- Constants --------------------------------------------------------------

type Phase = 'input' | 'planning' | 'simulation' | 'complete';
type Speed = 'normal' | 'fast' | 'skip';

const ACCENT = '#063ff9';
const ACCENT_BG = 'rgba(6, 63, 249, 0.08)';
const ACCENT_BORDER = 'rgba(6, 63, 249, 0.25)';
const GREEN = '#16A34A';
const GREEN_BG = 'rgba(22, 163, 74, 0.08)';
const GREEN_BORDER = 'rgba(22, 163, 74, 0.3)';
const SURFACE = 'rgba(6, 63, 249, 0.03)';
const SURFACE_BORDER = 'rgba(6, 63, 249, 0.08)';
const GLASS = 'rgba(255, 255, 255, 0.6)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.4)';

const STEP_MS: Record<Speed, number> = { normal: 3000, fast: 1500, skip: 0 };

const QUICK_TASKS = [
  { label: 'JWT Authentication', icon: '🔐', task: 'Build JWT authentication with refresh tokens' },
  { label: 'CI/CD Pipeline', icon: '🚀', task: 'Set up CI/CD pipeline with automated testing' },
  { label: 'Database Schema', icon: '🗄️', task: 'Design the database schema for multi-tenancy' },
  { label: 'Product Launch', icon: '📣', task: 'Plan the product launch strategy' },
];

// -- Styles -----------------------------------------------------------------

const glassCard = (active = false): React.CSSProperties => ({
  padding: '20px 24px',
  borderRadius: 12,
  border: `1px solid ${active ? ACCENT_BORDER : GLASS_BORDER}`,
  backgroundColor: active ? ACCENT_BG : GLASS,
  backdropFilter: 'blur(12px)',
  transition: 'all 0.35s ease',
});

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.5px',
  backgroundColor: color + '18',
  color,
  border: `1px solid ${color}33`,
});

// -- Component --------------------------------------------------------------

export function PlaygroundSuperBrain({ onClassicMode }: { onClassicMode?: () => void }) {
  const [phase, setPhase] = useState<Phase>('input');
  const [taskInput, setTaskInput] = useState('');
  const [scenario, setScenario] = useState<DemoScenario | null>(null);
  const [visibleAgents, setVisibleAgents] = useState(0);
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepProgress, setStepProgress] = useState<Record<number, 'pending' | 'typing' | 'done'>>({});
  const [typedChars, setTypedChars] = useState(0);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null; }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // -- Start simulation --------------------------------------------------

  const startSimulation = (task: string) => {
    const s = findScenario(task);
    setScenario(s);
    setTaskInput(task);
    setPhase('planning');
    setVisibleAgents(0);
    setCurrentStep(-1);
    setStepProgress({});
    setTypedChars(0);
    setPaused(false);

    const total = s.plan.length + s.skipped.length;
    for (let i = 0; i < total; i++) {
      setTimeout(() => setVisibleAgents(v => v + 1), 800 + i * 200);
    }
  };

  // -- Run steps ---------------------------------------------------------

  const runSteps = useCallback(() => {
    if (!scenario) return;
    setPhase('simulation');

    if (speed === 'skip') {
      const prog: Record<number, 'done'> = {};
      scenario.plan.forEach(s => { prog[s.step_number] = 'done'; });
      setStepProgress(prog);
      setCurrentStep(scenario.plan.length);
      setTimeout(() => setPhase('complete'), 300);
      return;
    }

    let stepIdx = 0;
    const playStep = () => {
      if (stepIdx >= scenario.plan.length) {
        setTimeout(() => setPhase('complete'), 600);
        return;
      }
      const step = scenario.plan[stepIdx];
      setCurrentStep(stepIdx);
      setStepProgress(p => ({ ...p, [step.step_number]: 'typing' }));
      setTypedChars(0);

      const output = step.output;
      const charMs = Math.max(5, STEP_MS[speed] * 0.4 / output.length);
      let chars = 0;
      typingRef.current = setInterval(() => {
        if (pausedRef.current) return;
        chars += 3;
        setTypedChars(Math.min(chars, output.length));
        if (chars >= output.length && typingRef.current) {
          clearInterval(typingRef.current);
          typingRef.current = null;
        }
      }, charMs);

      timerRef.current = setTimeout(() => {
        if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null; }
        setTypedChars(output.length);
        setStepProgress(p => ({ ...p, [step.step_number]: 'done' }));
        stepIdx++;
        timerRef.current = setTimeout(playStep, 400);
      }, STEP_MS[speed]);
    };

    playStep();
  }, [scenario, speed]);

  // -- Helpers -----------------------------------------------------------

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  // -- Step card renderer ------------------------------------------------

  const renderStepCard = (step: DemoStep) => {
    const status = stepProgress[step.step_number] || 'pending';
    const isActive = status === 'typing';
    const isDone = status === 'done';
    const showOutput = isActive || isDone;
    const isPending = status === 'pending' && currentStep >= 0;

    return (
      <div key={step.step_number} style={{
        ...glassCard(isActive),
        marginBottom: 16,
        opacity: isPending ? 0.35 : 1,
        transform: isPending ? 'scale(0.98)' : 'scale(1)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={badge(isDone ? GREEN : isActive ? ACCENT : '#6b7280')}>
              STEP {step.step_number}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>
              {step.agent_name}
            </span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
              {step.role_suggestion}
            </span>
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
            {step.decisions_compiled} decisions
          </span>
        </div>

        {/* Compiled decisions */}
        <div style={{
          ...glassCard(),
          padding: '10px 14px',
          marginBottom: step.new_from_previous ? 10 : showOutput ? 10 : 0,
        }}>
          {step.top_decisions.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-secondary)' }}>• {d.title}</span>
              <span style={{ fontFamily: 'monospace', color: '#6b7280', marginLeft: 12, whiteSpace: 'nowrap' }}>{d.score.toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Green "NEW FROM PREVIOUS STEP" box */}
        {step.new_from_previous && (
          <div style={{
            padding: '12px 16px', marginBottom: showOutput ? 10 : 0,
            borderRadius: 8, border: `1px solid ${GREEN_BORDER}`, backgroundColor: GREEN_BG,
          }}>
            <div style={{ color: GREEN, fontWeight: 700, fontSize: 11, letterSpacing: '0.5px', marginBottom: 4 }}>
              NEW FROM PREVIOUS STEP
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>{step.new_from_previous}</div>
          </div>
        )}

        {/* Agent output with typing animation */}
        {showOutput && (
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.4)',
            fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7,
          }}>
            <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 6, letterSpacing: '0.5px' }}>OUTPUT</div>
            {isDone ? step.output : step.output.slice(0, typedChars)}
            {isActive && <span className="blink-cursor">▊</span>}
          </div>
        )}

        {/* Handoff arrow */}
        {isDone && step.step_number < (scenario?.plan.length ?? 0) && (
          <div style={{ textAlign: 'center', color: ACCENT, padding: '10px 0', fontSize: 13, fontWeight: 500 }}>
            ↓ passing context to {scenario?.plan[step.step_number]?.agent_name}...
          </div>
        )}
      </div>
    );
  };

  // -- SCREEN 1: Hero + Task Input ---------------------------------------

  if (phase === 'input') {
    return (
      <div style={{ maxWidth: 680, margin: '40px auto', padding: '20px' }}>
        {/* Blink cursor animation */}
        <style>{`@keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } } .blink-cursor { animation: blink 1s infinite; color: ${ACCENT}; }`}</style>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.2, marginBottom: 12 }}>
            <span style={{ color: 'var(--text-primary)' }}>Watch the Brain</span><br />
            <span style={{ color: '#063ff9' }}>Run Your Team</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 17, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            Type a task. The Super Brain builds a plan, picks the right agents, and coordinates them step by step.
          </div>
        </div>

        {/* Quick-start scenario buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 32 }}>
          {QUICK_TASKS.map((qt, i) => (
            <button key={i} onClick={() => startSimulation(qt.task)} style={{
              ...glassCard(),
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <span style={{ fontSize: 28 }}>{qt.icon}</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{qt.label}</div>
                <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{qt.task}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => startSimulation(taskInput || QUICK_TASKS[0].task)}
          disabled={false}
          style={{
            width: '100%', padding: '14px 24px', fontSize: 16, fontWeight: 700,
            backgroundColor: ACCENT, color: '#fff', border: 'none', borderRadius: 10,
            cursor: 'pointer', letterSpacing: '0.3px',
            transition: 'all 0.2s ease',
          }}
        >
          Run Full Simulation
        </button>

        {onClassicMode && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button onClick={onClassicMode}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13 }}>
              Switch to Classic Mode →
            </button>
          </div>
        )}
      </div>
    );
  }

  // -- SCREEN 2: Team Plan -----------------------------------------------

  if (phase === 'planning' && scenario) {
    const allAgents = [
      ...scenario.plan.map(s => ({ ...s, skipped: false })),
      ...scenario.skipped.map((s, i) => ({
        step_number: scenario.plan.length + i + 1,
        agent_name: s.agent_name,
        relevance_score: s.relevance_score,
        role_suggestion: 'skip',
        task_suggestion: s.reason,
        skipped: true,
      })),
    ];

    return (
      <div style={{ maxWidth: 680, margin: '40px auto', padding: 20 }}>
        <style>{`@keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } } .blink-cursor { animation: blink 1s infinite; color: ${ACCENT}; }`}</style>

        <div style={{ marginBottom: 8 }}>
          <span style={badge(ACCENT)}>TEAM PLAN</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          {scenario.plan.length} agents selected
        </div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14, marginBottom: 24 }}>"{taskInput}"</div>

        {/* Agent list */}
        <div style={{ marginBottom: 28 }}>
          {allAgents.map((a, i) => {
            const visible = i < visibleAgents;
            const isSkipped = a.skipped;
            return (
              <div key={i} style={{
                ...glassCard(),
                padding: '14px 18px',
                marginBottom: 8,
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(16px)',
                transition: 'all 0.4s ease',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Relevance bar */}
                  <div style={{ width: 48, textAlign: 'right' }}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
                      color: isSkipped ? '#4b5563' : a.relevance_score >= 0.6 ? GREEN : a.relevance_score >= 0.3 ? ACCENT : '#6b7280',
                    }}>
                      {pct(a.relevance_score)}
                    </span>
                  </div>
                  {/* Mini bar */}
                  <div style={{ width: 60, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${a.relevance_score * 100}%`, height: '100%', borderRadius: 3,
                      backgroundColor: isSkipped ? '#4b5563' : a.relevance_score >= 0.6 ? GREEN : a.relevance_score >= 0.3 ? ACCENT : '#6b7280',
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  {/* Name + role */}
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, color: isSkipped ? '#6b7280' : '#e5e7eb' }}>
                      {a.agent_name}
                    </span>
                    {!isSkipped && 'role_suggestion' in a && (
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 13 }}>
                        {(a as unknown as DemoStep).role_suggestion}
                      </span>
                    )}
                  </div>
                  {/* Status badge */}
                  <span style={badge(isSkipped ? '#4b5563' : GREEN)}>
                    {isSkipped ? 'SKIP' : `STEP ${a.step_number}`}
                  </span>
                </div>
                {!isSkipped && 'task_suggestion' in a && (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 6, paddingLeft: 132 }}>
                    → {(a as unknown as DemoStep).task_suggestion}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={runSteps} style={{
            flex: 1, padding: 14, fontSize: 15, fontWeight: 700,
            backgroundColor: ACCENT, color: '#fff', border: 'none', borderRadius: 10,
            cursor: 'pointer', transition: 'all 0.2s',
          }}>
            ▶ Run Simulation
          </button>
          <button onClick={() => { setSpeed('skip'); setTimeout(runSteps, 0); }} style={{
            padding: '14px 20px', fontSize: 14,
            backgroundColor: SURFACE, color: 'var(--text-tertiary)', border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 10, cursor: 'pointer',
          }}>
            ⏭ Skip
          </button>
        </div>
      </div>
    );
  }

  // -- SCREEN 3: Step-by-Step Simulation ---------------------------------

  if (phase === 'simulation' && scenario) {
    const doneCount = Object.values(stepProgress).filter(s => s === 'done').length;
    const progress = doneCount / scenario.plan.length;

    return (
      <div style={{ maxWidth: 740, margin: '20px auto', padding: 20 }}>
        <style>{`@keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } } .blink-cursor { animation: blink 1s infinite; color: ${ACCENT}; }`}</style>

        {/* Progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: ACCENT, borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {doneCount}/{scenario.plan.length}
          </span>
        </div>

        {/* Speed controls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['normal', 'fast'] as Speed[]).map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{
              padding: '5px 14px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
              backgroundColor: speed === s ? ACCENT : SURFACE,
              color: speed === s ? '#fff' : '#9ca3af',
              fontWeight: speed === s ? 700 : 400,
              transition: 'all 0.2s',
            }}>
              {s === 'normal' ? '1x' : '2x'}
            </button>
          ))}
          <button onClick={() => setPaused(p => !p)} style={{
            padding: '5px 14px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
            backgroundColor: paused ? ACCENT : SURFACE, color: paused ? '#fff' : '#9ca3af',
          }}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button onClick={() => { setSpeed('skip'); clearTimers(); const prog: Record<number, 'done'> = {}; scenario.plan.forEach(s => { prog[s.step_number] = 'done'; }); setStepProgress(prog); setCurrentStep(scenario.plan.length); setTimeout(() => setPhase('complete'), 300); }} style={{
            padding: '5px 14px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
            backgroundColor: SURFACE, color: 'var(--text-tertiary)',
          }}>
            ⏭ Skip
          </button>
        </div>

        {/* Steps */}
        {scenario.plan.map(step => renderStepCard(step))}
      </div>
    );
  }

  // -- SCREEN 4: Completion ----------------------------------------------

  if (phase === 'complete' && scenario) {
    return (
      <div style={{ maxWidth: 680, margin: '40px auto', padding: 20 }}>
        {/* Complete bar */}
        <div style={{ height: 4, backgroundColor: GREEN, borderRadius: 2, marginBottom: 32 }} />

        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            Task Complete
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 15 }}>
            {scenario.plan.length} agents coordinated • {scenario.plan.reduce((s, st) => s + st.decisions_compiled, 0)} decisions compiled • 0 conflicts
          </div>
        </div>

        {/* Efficiency bars */}
        <div style={{ ...glassCard(), marginBottom: 24 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16, fontSize: 14, letterSpacing: '0.3px' }}>
            Context Efficiency
          </div>
          {scenario.plan.map((step, i) => (
            <div key={i} style={{ marginBottom: i < scenario.plan.length - 1 ? 16 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 14 }}>{step.agent_name}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                  {step.decisions_compiled}/{scenario.totalDecisions} decisions ({Math.round(step.decisions_compiled / scenario.totalDecisions * 100)}%)
                </span>
              </div>
              <div style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${step.decisions_compiled / scenario.totalDecisions * 100}%`,
                  height: '100%', backgroundColor: ACCENT, borderRadius: 3,
                  transition: 'width 1.2s ease',
                }} />
              </div>
              {step.new_from_previous && (
                <div style={{ fontSize: 12, color: GREEN, marginTop: 3, fontWeight: 500 }}>
                  + context from {i} previous step{i > 1 ? 's' : ''}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* With vs Without comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
          <div style={{ ...glassCard(), opacity: 0.7 }}>
            <div style={{ fontWeight: 700, color: '#6b7280', marginBottom: 10, fontSize: 12, letterSpacing: '0.5px' }}>WITHOUT HIPP0</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1.6 }}>
              Every agent sees all {scenario.totalDecisions} decisions or none. No agent knows what the previous one decided. Wasted tokens, repeated work, missed context.
            </div>
          </div>
          <div style={{ padding: '20px 24px', borderRadius: 12, border: `1px solid ${GREEN_BORDER}`, backgroundColor: GREEN_BG }}>
            <div style={{ fontWeight: 700, color: GREEN, marginBottom: 10, fontSize: 12, letterSpacing: '0.5px' }}>WITH HIPP0</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
              Each agent sees only what matters to them. Every step builds on the last. The brain coordinates the whole team automatically.
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ ...glassCard(), textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16, fontSize: 18 }}>
            Give your agents a shared brain
          </div>
          <a href="https://github.com/perlantir/Hipp0" target="_blank" rel="noopener"
            style={{
              display: 'inline-block', padding: '12px 28px',
              backgroundColor: ACCENT, color: '#fff', borderRadius: 10,
              fontWeight: 700, textDecoration: 'none', fontSize: 15,
              transition: 'all 0.2s',
            }}>
            Star on GitHub
          </a>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            {[
              'npx @hipp0/cli init my-project',
              'docker compose up -d',
            ].map((cmd, i) => (
              <button key={i} onClick={() => navigator.clipboard?.writeText(cmd)} style={{
                padding: '8px 14px', background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(24px)',
                color: 'var(--text-tertiary)', border: `1px solid ${SURFACE_BORDER}`, borderRadius: 8,
                fontSize: 12, fontFamily: 'monospace', cursor: 'pointer',
                transition: 'all 0.2s',
              }}>
                {cmd} 📋
              </button>
            ))}
          </div>
        </div>

        {/* Bottom actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={() => { setPhase('input'); setScenario(null); setTaskInput(''); }} style={{
            padding: '10px 24px', backgroundColor: SURFACE, color: 'var(--text-primary)',
            border: `1px solid ${SURFACE_BORDER}`, borderRadius: 10, cursor: 'pointer', fontWeight: 500,
          }}>
            Try Another Task
          </button>
          {onClassicMode && (
            <button onClick={onClassicMode} style={{
              padding: '10px 24px', background: 'none', border: 'none',
              color: '#6b7280', cursor: 'pointer', fontSize: 13,
            }}>
              Classic Mode →
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
