import { useEffect, useState } from 'react';
import {
  Check,
  X,
  Loader2,
  Crown,
  Zap,
  Building2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UsageData {
  plan: string;
  today: { compiles: number; asks: number; decisions: number };
  totals: { decisions: number; projects: number; agents: number };
}

/* ------------------------------------------------------------------ */
/*  Plan definitions                                                   */
/* ------------------------------------------------------------------ */

interface PlanDef {
  id: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  icon: React.ReactNode;
  color: string;
  features: Array<{ label: string; included: boolean; detail?: string }>;
  limits: {
    projects: string;
    decisions: string;
    agents: string;
    compilesPerDay: string;
    asksPerDay: string;
    integrations: string;
  };
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    icon: <Zap size={20} />,
    color: '#6B7280',
    features: [
      { label: '1 project', included: true },
      { label: '100 decisions', included: true },
      { label: '3 agents', included: true },
      { label: '50 compiles/day', included: true },
      { label: '10 Ask Anything/day', included: true },
      { label: 'Community support', included: true },
      { label: 'Integrations', included: false },
      { label: 'Priority API', included: false },
    ],
    limits: {
      projects: '1',
      decisions: '100',
      agents: '3',
      compilesPerDay: '50',
      asksPerDay: '10',
      integrations: 'None',
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 29,
    annualPrice: 278,
    icon: <Crown size={20} />,
    color: 'var(--accent-primary)',
    features: [
      { label: 'Unlimited projects', included: true },
      { label: '10,000 decisions', included: true },
      { label: 'Unlimited agents', included: true },
      { label: '1,000 compiles/day', included: true },
      { label: '100 Ask Anything/day', included: true },
      { label: 'Email support', included: true },
      { label: 'All integrations', included: true, detail: 'Slack, Discord, GitHub, Telegram' },
      { label: 'Priority API', included: false },
    ],
    limits: {
      projects: 'Unlimited',
      decisions: '10,000',
      agents: 'Unlimited',
      compilesPerDay: '1,000',
      asksPerDay: '100',
      integrations: 'All',
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 299,
    annualPrice: 2870,
    icon: <Building2 size={20} />,
    color: '#7C3AED',
    features: [
      { label: 'Unlimited projects', included: true },
      { label: 'Unlimited decisions', included: true },
      { label: 'Unlimited agents', included: true },
      { label: 'Unlimited compiles', included: true },
      { label: 'Unlimited Ask Anything', included: true },
      { label: 'Dedicated support + SLA', included: true },
      { label: 'All integrations + custom', included: true },
      { label: 'Priority API + SSO + audit log', included: true },
    ],
    limits: {
      projects: 'Unlimited',
      decisions: 'Unlimited',
      agents: 'Unlimited',
      compilesPerDay: 'Unlimited',
      asksPerDay: 'Unlimited',
      integrations: 'All + custom',
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Usage meter component                                              */
/* ------------------------------------------------------------------ */

function UsageMeter({ label, current, max, color }: { label: string; current: number; max: number | null; color: string }) {
  if (max === null || max === 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>{label}</span>
          <span>{current.toLocaleString()} / Unlimited</span>
        </div>
        <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-light)' }}>
          <div className="h-full rounded-full opacity-40" style={{ width: '5%', background: color }} />
        </div>
      </div>
    );
  }

  const pct = Math.min((current / max) * 100, 100);
  const isWarning = pct >= 80;
  const isLimit = pct >= 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span className={isLimit ? 'font-semibold text-red-500' : isWarning ? 'font-semibold text-amber-500' : ''}>
          {current.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-light)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(pct, 2)}%`,
            background: isLimit ? '#EF4444' : isWarning ? '#F59E0B' : color,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pricing component                                                  */
/* ------------------------------------------------------------------ */

export function Pricing() {
  const { get, post } = useApi();
  const [annual, setAnnual] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<UsageData>('/api/billing/usage')
      .then((data) => { if (!cancelled) setUsage(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [get]);

  const currentPlan = usage?.plan ?? 'free';

  async function handleUpgrade(planId: string) {
    if (planId === 'free' || planId === currentPlan) return;
    setCheckoutLoading(planId);
    try {
      const result = await post<{ checkout_url?: string; prorated?: boolean }>('/api/billing/checkout', {
        plan: planId,
        interval: annual ? 'annual' : 'monthly',
      });
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
      } else if (result.prorated) {
        // Plan changed via proration — reload usage
        const updated = await get<UsageData>('/api/billing/usage');
        setUsage(updated);
      }
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setCheckoutLoading(null);
    }
  }

  // Determine limits for usage meters based on current plan
  const planDef = PLANS.find((p) => p.id === currentPlan) ?? PLANS[0];
  const decisionLimit = currentPlan === 'free' ? 100 : currentPlan === 'pro' ? 10000 : null;
  const compileLimit = currentPlan === 'free' ? 50 : currentPlan === 'pro' ? 1000 : null;
  const askLimit = currentPlan === 'free' ? 10 : currentPlan === 'pro' ? 100 : null;

  return (
    <div className="p-6 md:p-12 max-w-6xl mx-auto space-y-10">
      {/* Header */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Plans & Pricing
        </h1>
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Choose the plan that fits your team. Upgrade or downgrade at any time.
        </p>
      </div>

      {/* Annual toggle */}
      <div className="flex items-center justify-center gap-3">
        <span
          className="text-sm font-medium"
          style={{ color: annual ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
        >
          Monthly
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          style={{ background: annual ? 'var(--accent-primary)' : 'var(--border-medium)' }}
        >
          <span
            className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
            style={{ transform: annual ? 'translateX(22px)' : 'translateX(4px)' }}
          />
        </button>
        <span
          className="text-sm font-medium"
          style={{ color: annual ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
        >
          Annual
        </span>
        {annual && (
          <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: 'rgba(6,63,249,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(6,63,249,0.2)' }}>
            Save 20%
          </span>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-8">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const isPopular = plan.id === 'pro';
          const price = annual ? plan.annualPrice : plan.monthlyPrice;
          const perMonth = annual ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;

          return (
            <div
              key={plan.id}
              className="card relative flex flex-col"
              style={{
                borderRadius: 20,
                borderColor: isPopular ? 'var(--accent-primary)' : isCurrent ? plan.color : 'rgba(255,255,255,0.4)',
                borderWidth: isPopular ? '2px' : '1px',
                boxShadow: isPopular ? '0 0 30px rgba(6,63,249,0.12), 0 20px 40px rgba(0,0,0,0.05)' : '0 20px 40px rgba(0,0,0,0.05)',
                transform: isPopular ? 'scale(1.02)' : undefined,
              }}
            >
              {isPopular && (
                <div
                  className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-bold px-4 py-1 rounded-full text-white tracking-wide"
                  style={{ background: 'var(--accent-primary)', boxShadow: '0 0 16px rgba(6,63,249,0.4)' }}
                >
                  Most Popular
                </div>
              )}

              {isCurrent && (
                <div
                  className="absolute -top-3.5 right-4 text-xs font-bold px-4 py-1 rounded-full"
                  style={{ background: 'var(--accent-success)', color: 'white' }}
                >
                  Current Plan
                </div>
              )}

              <div className="p-7 space-y-5 flex-1">
                {/* Plan name & icon */}
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md"
                    style={{ background: plan.color }}
                  >
                    {plan.icon}
                  </div>
                  <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {plan.name}
                  </h3>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    ${plan.id === 'free' ? '0' : perMonth}
                  </span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    /mo
                  </span>
                  {annual && plan.id !== 'free' && (
                    <span className="text-xs ml-2 font-medium" style={{ color: 'var(--text-tertiary)' }}>
                      (${price}/yr)
                    </span>
                  )}
                </div>

                {/* Features list */}
                <ul className="space-y-3">
                  {plan.features.map((feat, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      {feat.included ? (
                        <Check size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--accent-success)' }} />
                      ) : (
                        <X size={16} className="text-gray-300 shrink-0 mt-0.5" />
                      )}
                      <span style={{ color: feat.included ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                        {feat.label}
                        {feat.detail && (
                          <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>
                            ({feat.detail})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA button */}
              <div className="p-7 pt-0">
                {plan.id === 'free' ? (
                  <button
                    disabled
                    className="btn-secondary w-full opacity-50 cursor-not-allowed"
                    style={{ borderRadius: 12, padding: '12px 20px' }}
                  >
                    {isCurrent ? 'Current Plan' : 'Free Forever'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={isCurrent || checkoutLoading !== null}
                    className={`w-full ${isCurrent ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                    style={{
                      borderRadius: 12,
                      padding: '12px 20px',
                      fontWeight: 700,
                      boxShadow: !isCurrent ? '0 0 20px rgba(6,63,249,0.4)' : undefined,
                    }}
                  >
                    {checkoutLoading === plan.id ? (
                      <Loader2 size={16} className="animate-spin mx-auto" />
                    ) : isCurrent ? (
                      'Current Plan'
                    ) : currentPlan !== 'free' && plan.id === 'free' ? (
                      'Downgrade'
                    ) : (
                      `Upgrade to ${plan.name}`
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Usage meters */}
      <div className="card p-8 space-y-5" style={{ borderRadius: 24 }}>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Current Usage
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : usage ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UsageMeter
              label="Total Decisions"
              current={usage.totals.decisions}
              max={decisionLimit}
              color="var(--accent-primary)"
            />
            <UsageMeter
              label="Compiles Today"
              current={usage.today.compiles}
              max={compileLimit}
              color="#3B82F6"
            />
            <UsageMeter
              label="Ask Anything Today"
              current={usage.today.asks}
              max={askLimit}
              color="#8B5CF6"
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>Projects</span>
                <span>{usage.totals.projects} / {planDef.limits.projects}</span>
              </div>
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>Agents</span>
                <span>{usage.totals.agents} / {planDef.limits.agents}</span>
              </div>
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>Integrations</span>
                <span>{planDef.limits.integrations}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Unable to load usage data.
          </p>
        )}
      </div>
    </div>
  );
}
