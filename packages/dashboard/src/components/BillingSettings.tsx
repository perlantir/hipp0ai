import { useEffect, useState } from 'react';
import {
  CreditCard,
  FileText,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Crown,
  Building2,
  Zap,
  Calendar,
  Download,
  X,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SubscriptionData {
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  payment_method: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  } | null;
}

interface Invoice {
  id: string;
  number: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  pdf: string | null;
  created: string | null;
}

interface UsageData {
  plan: string;
  today: { compiles: number; asks: number; decisions: number };
  totals: { decisions: number; projects: number; agents: number };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function planIcon(plan: string) {
  switch (plan) {
    case 'enterprise': return <Building2 size={18} />;
    case 'pro': return <Crown size={18} />;
    default: return <Zap size={18} />;
  }
}

function planColor(plan: string) {
  switch (plan) {
    case 'enterprise': return '#7C3AED';
    case 'pro': return '#063ff9';
    default: return '#6B7280';
  }
}

function planLabel(plan: string) {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; text: string; dot: string }> = {
    paid: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    open: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
    draft: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
    void: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
    uncollectible: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  };
  const c = colors[status] ?? { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Retention modal                                                    */
/* ------------------------------------------------------------------ */

function CancelModal({
  onConfirm,
  onClose,
  loading,
}: {
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative card p-8 max-w-md w-full space-y-5"
        style={{ borderRadius: 24 }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100"
        >
          <X size={16} style={{ color: 'var(--text-tertiary)' }} />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Before you go...
          </h3>
        </div>

        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            We'd hate to see you leave! Here's what you'll lose:
          </p>
          <ul className="text-sm space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Unlimited projects and agents
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Higher daily compile and ask limits
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              All integrations (Slack, Discord, GitHub)
            </li>
          </ul>

          <div
            className="rounded-lg p-3 text-sm"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)' }}
          >
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Special offer: Stay and get 20% off your next 3 months!
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Contact support@hipp0.ai to claim this offer.
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-primary flex-1">
            Keep My Plan
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="btn-secondary flex-1 text-red-600 hover:text-red-700"
          >
            {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Cancel Anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BillingSettings component                                          */
/* ------------------------------------------------------------------ */

export function BillingSettings() {
  const { get, post } = useApi();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      get<SubscriptionData>('/api/billing/subscription').catch(() => null),
      get<{ invoices: Invoice[] }>('/api/billing/invoices').catch(() => ({ invoices: [] })),
      get<UsageData>('/api/billing/usage').catch(() => null),
    ]).then(([sub, inv, usg]) => {
      if (cancelled) return;
      setSubscription(sub);
      setInvoices(inv?.invoices ?? []);
      setUsage(usg);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [get]);

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const result = await post<{ portal_url: string }>('/api/billing/portal', {});
      if (result.portal_url) {
        window.location.href = result.portal_url;
      }
    } catch (err) {
      console.error('Portal error:', err);
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleCancelConfirm() {
    setCancelLoading(true);
    try {
      // Redirect to Stripe portal for cancellation
      const result = await post<{ portal_url: string }>('/api/billing/portal', {});
      if (result.portal_url) {
        window.location.href = result.portal_url;
      }
    } catch (err) {
      console.error('Cancel error:', err);
    } finally {
      setCancelLoading(false);
      setCancelModalOpen(false);
    }
  }

  const plan = subscription?.plan ?? usage?.plan ?? 'free';
  const isFree = plan === 'free';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-12 max-w-5xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        Billing & Subscription
      </h1>

      {/* Current plan card */}
      <div className="card p-8 space-y-5" style={{ borderRadius: 24 }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg"
              style={{ background: planColor(plan) }}
            >
              {planIcon(plan)}
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                {planLabel(plan)} Plan
              </h2>
              {subscription?.current_period_end && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  <Calendar size={12} className="inline mr-1" />
                  {subscription.cancel_at_period_end ? 'Cancels' : 'Renews'} on{' '}
                  {formatDate(subscription.current_period_end)}
                </p>
              )}
              {subscription?.cancel_at_period_end && (
                <p className="text-xs text-amber-600 font-medium mt-0.5">
                  Subscription will end at period close
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {!isFree && (
              <>
                <button
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                  className="btn-primary text-sm font-bold"
                  style={{ borderRadius: 12, padding: '10px 20px', boxShadow: '0 0 20px rgba(6,63,249,0.4)' }}
                >
                  {portalLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <>
                      <ExternalLink size={14} className="mr-1.5 inline" />
                      Manage Subscription
                    </>
                  )}
                </button>
                <button
                  onClick={() => setCancelModalOpen(true)}
                  className="btn-ghost text-sm text-red-500 hover:text-red-600"
                >
                  Cancel
                </button>
              </>
            )}
            {isFree && (
              <a href="#pricing" className="btn-primary text-sm">
                Upgrade
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Usage this period */}
      {usage && (
        <div className="card p-8 space-y-5" style={{ borderRadius: 24 }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Usage This Billing Period
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="card rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.5)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Decisions</p>
              <p className="text-2xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
                {usage.totals.decisions.toLocaleString()}
              </p>
            </div>
            <div className="card rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.5)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Compiles Today</p>
              <p className="text-2xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
                {usage.today.compiles.toLocaleString()}
              </p>
            </div>
            <div className="card rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.5)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Ask Anything Today</p>
              <p className="text-2xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
                {usage.today.asks.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Payment method */}
      {subscription?.payment_method && (
        <div className="card p-8 space-y-4" style={{ borderRadius: 24 }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Payment Method
          </h2>
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-10 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <CreditCard size={16} style={{ color: 'var(--text-tertiary)' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {subscription.payment_method.brand.charAt(0).toUpperCase() + subscription.payment_method.brand.slice(1)} ending in {subscription.payment_method.last4}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Expires {subscription.payment_method.exp_month}/{subscription.payment_method.exp_year}
              </p>
            </div>
            <button
              onClick={handleManageSubscription}
              className="ml-auto text-xs font-medium"
              style={{ color: 'var(--accent-primary)' }}
            >
              Update
            </button>
          </div>
        </div>
      )}

      {/* Invoice history */}
      <div className="card p-8 space-y-5" style={{ borderRadius: 24, overflow: 'hidden' }}>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Invoice History
        </h2>
        {invoices.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
            No invoices yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                  <th className="text-left py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Date</th>
                  <th className="text-left py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Invoice</th>
                  <th className="text-left py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Status</th>
                  <th className="text-right py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Amount</th>
                  <th className="text-right py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-white/30 transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                    <td className="py-4" style={{ color: 'var(--text-primary)' }}>
                      <span className="font-bold">{inv.created ? formatDate(inv.created) : '-'}</span>
                    </td>
                    <td className="py-4" style={{ color: 'var(--text-secondary)' }}>
                      {inv.number ?? inv.id.slice(0, 12)}
                    </td>
                    <td className="py-4">{statusBadge(inv.status ?? 'draft')}</td>
                    <td className="py-4 text-right font-bold" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(inv.amount_due, inv.currency)}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {inv.hosted_invoice_url && (
                          <a
                            href={inv.hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            View
                          </a>
                        )}
                        {inv.pdf && (
                          <a
                            href={inv.pdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Download PDF"
                          >
                            <Download size={14} style={{ color: 'var(--text-tertiary)' }} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel modal */}
      {cancelModalOpen && (
        <CancelModal
          onConfirm={handleCancelConfirm}
          onClose={() => setCancelModalOpen(false)}
          loading={cancelLoading}
        />
      )}
    </div>
  );
}
