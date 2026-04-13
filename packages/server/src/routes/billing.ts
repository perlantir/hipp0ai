import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { ValidationError } from '@hipp0/core/types.js';
import { getUser, getTenantId } from '../auth/middleware.js';
import Stripe from 'stripe';

  // Stripe client
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

  // Price ID lookup
interface PriceConfig {
  pro_monthly: string;
  pro_annual: string;
  enterprise_monthly: string;
  enterprise_annual: string;
}

function getPriceIds(): PriceConfig {
  return {
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? '',
    pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? '',
    enterprise_monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? '',
    enterprise_annual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL ?? '',
  };
}

function resolvePriceId(plan: string, interval: string): string {
  const prices = getPriceIds();
  const key = `${plan}_${interval}` as keyof PriceConfig;
  const priceId = prices[key];
  if (!priceId) throw new ValidationError(`No price configured for ${plan}/${interval}`);
  return priceId;
}

  // Ensure Stripe customer exists for tenant
async function ensureStripeCustomer(tenantId: string): Promise<string> {
  const db = getDb();
  const result = await db.query(
    'SELECT stripe_customer_id, name, slug FROM tenants WHERE id = ?',
    [tenantId],
  );
  if (result.rows.length === 0) throw new ValidationError('Tenant not found');

  const tenant = result.rows[0] as Record<string, unknown>;
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id as string;

  // Create Stripe customer
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: tenant.name as string,
    metadata: { tenant_id: tenantId, slug: tenant.slug as string },
  });

  await db.query(
    'UPDATE tenants SET stripe_customer_id = ?, updated_at = NOW() WHERE id = ?',
    [customer.id, tenantId],
  );

  return customer.id;
}

  // Register billing routes
export function registerBillingRoutes(app: Hono): void {
  /**
   * POST /api/billing/checkout — Create Stripe Checkout session for plan subscription.
   * Body: { plan: 'pro' | 'enterprise', interval: 'monthly' | 'annual' }
   */
  app.post('/api/billing/checkout', async (c) => {
    const body = await c.req.json<{ plan?: string; interval?: string }>();
    const plan = body.plan;
    const interval = body.interval ?? 'monthly';

    if (!plan || !['pro', 'enterprise'].includes(plan)) {
      throw new ValidationError('plan must be "pro" or "enterprise"');
    }
    if (!['monthly', 'annual'].includes(interval)) {
      throw new ValidationError('interval must be "monthly" or "annual"');
    }

    const tenantId = getTenantId(c);
    const customerId = await ensureStripeCustomer(tenantId);
    const priceId = resolvePriceId(plan, interval);
    const stripe = getStripe();

    // Check if tenant already has an active subscription (plan change = proration)
    const db = getDb();
    const tenantResult = await db.query(
      'SELECT stripe_subscription_id, plan FROM tenants WHERE id = ?',
      [tenantId],
    );
    const tenant = tenantResult.rows[0] as Record<string, unknown> | undefined;
    const existingSubId = tenant?.stripe_subscription_id as string | undefined;

    if (existingSubId) {
      // Existing subscription — update with proration
      const subscription = await stripe.subscriptions.retrieve(existingSubId);
      if (subscription.status === 'active' || subscription.status === 'trialing') {
        const updated = await stripe.subscriptions.update(existingSubId, {
          items: [{
            id: subscription.items.data[0].id,
            price: priceId,
          }],
          proration_behavior: 'create_prorations',
        });
        // Plan update handled by customer.subscription.updated webhook
        return c.json({ subscription_id: updated.id, status: updated.status, prorated: true });
      }
    }

    // New subscription — create Checkout session
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3200';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${dashboardUrl}/#billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${dashboardUrl}/#pricing`,
      metadata: { tenant_id: tenantId, plan, interval },
      subscription_data: {
        metadata: { tenant_id: tenantId, plan },
      },
    });

    return c.json({ checkout_url: session.url, session_id: session.id });
  });

  /**
   * POST /api/billing/portal — Create Stripe Customer Portal session.
   */
  app.post('/api/billing/portal', async (c) => {
    const tenantId = getTenantId(c);
    const customerId = await ensureStripeCustomer(tenantId);
    const stripe = getStripe();

    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3200';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${dashboardUrl}/#billing`,
    });

    return c.json({ portal_url: session.url });
  });

  /**
   * GET /api/billing/invoices — List invoices for current tenant.
   */
  app.get('/api/billing/invoices', async (c) => {
    const tenantId = getTenantId(c);
    const db = getDb();

    const result = await db.query(
      'SELECT stripe_customer_id FROM tenants WHERE id = ?',
      [tenantId],
    );
    if (result.rows.length === 0) throw new ValidationError('Tenant not found');

    const customerId = (result.rows[0] as Record<string, unknown>).stripe_customer_id as string | null;
    if (!customerId) {
      return c.json({ invoices: [] });
    }

    const stripe = getStripe();
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 24,
    });

    return c.json({
      invoices: invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount_due: inv.amount_due,
        amount_paid: inv.amount_paid,
        currency: inv.currency,
        period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
        period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
        hosted_invoice_url: inv.hosted_invoice_url,
        pdf: inv.invoice_pdf,
        created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      })),
    });
  });

  /**
   * GET /api/billing/subscription — Get current subscription details.
   */
  app.get('/api/billing/subscription', async (c) => {
    const tenantId = getTenantId(c);
    const db = getDb();

    const result = await db.query(
      'SELECT plan, stripe_customer_id, stripe_subscription_id FROM tenants WHERE id = ?',
      [tenantId],
    );
    if (result.rows.length === 0) throw new ValidationError('Tenant not found');

    const tenant = result.rows[0] as Record<string, unknown>;
    const subId = tenant.stripe_subscription_id as string | null;

    if (!subId) {
      return c.json({
        plan: tenant.plan,
        status: tenant.plan === 'free' ? 'free' : 'unknown',
        current_period_end: null,
        cancel_at_period_end: false,
        payment_method: null,
      });
    }

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subId, {
      expand: ['default_payment_method'],
    });

    const pm = subscription.default_payment_method as Stripe.PaymentMethod | null;

    return c.json({
      plan: tenant.plan,
      status: subscription.status,
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      payment_method: pm?.card ? {
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
      } : null,
    });
  });

  /**
   * GET /api/billing/usage — Get current billing period usage for tenant.
   */
  app.get('/api/billing/usage', async (c) => {
    const tenantId = getTenantId(c);
    const db = getDb();

    // Get today's usage
    const todayResult = await db.query(
      `SELECT compiles_count, ask_count, decisions_count
       FROM daily_usage
       WHERE tenant_id = ? AND date = CURRENT_DATE`,
      [tenantId],
    );

    const today = todayResult.rows[0] as Record<string, unknown> | undefined;

    // Get total decisions count for the tenant
    const decisionsResult = await db.query(
      'SELECT COUNT(*) as total FROM decisions WHERE tenant_id = ?',
      [tenantId],
    );
    const totalDecisions = Number((decisionsResult.rows[0] as Record<string, unknown>)?.total ?? 0);

    // Get project count (tenant-scoped)
    const projectsResult = await db.query(
      'SELECT COUNT(*) as total FROM projects WHERE tenant_id = ?',
      [tenantId],
    );
    const totalProjects = Number((projectsResult.rows[0] as Record<string, unknown>)?.total ?? 0);

    // Get agent count (tenant-scoped via projects)
    const agentsResult = await db.query(
      'SELECT COUNT(DISTINCT a.name) as total FROM agents a JOIN projects p ON p.id = a.project_id WHERE p.tenant_id = ?',
      [tenantId],
    );
    const totalAgents = Number((agentsResult.rows[0] as Record<string, unknown>)?.total ?? 0);

    // Get tenant plan
    const tenantResult = await db.query('SELECT plan FROM tenants WHERE id = ?', [tenantId]);
    const plan = (tenantResult.rows[0] as Record<string, unknown>)?.plan as string ?? 'free';

    return c.json({
      plan,
      today: {
        compiles: Number(today?.compiles_count ?? 0),
        asks: Number(today?.ask_count ?? 0),
        decisions: Number(today?.decisions_count ?? 0),
      },
      totals: {
        decisions: totalDecisions,
        projects: totalProjects,
        agents: totalAgents,
      },
    });
  });
}

  // Stripe Webhook Handler (separate registration — needs raw body)
export function registerStripeWebhookRoute(app: Hono): void {
  app.post('/api/webhooks/stripe', async (c) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[billing] STRIPE_WEBHOOK_SECRET not set');
      return c.json({ error: 'Webhook not configured' }, 500);
    }

    const stripe = getStripe();
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json({ error: 'Missing stripe-signature header' }, 400);
    }

    // Get raw body for signature verification
    const rawBody = await c.req.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error('[billing] Webhook signature verification failed:', (err as Error).message);
      return c.json({ error: 'Invalid signature' }, 400);
    }

    const db = getDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenant_id;
        const plan = session.metadata?.plan;
        const subscriptionId = session.subscription as string;

        if (tenantId && plan && subscriptionId) {
          await db.query(
            `UPDATE tenants
             SET plan = ?, stripe_subscription_id = ?, updated_at = NOW()
             WHERE id = ?`,
            [plan, subscriptionId, tenantId],
          );
          console.warn(`[billing] Tenant ${tenantId} upgraded to ${plan}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenant_id;

        if (tenantId) {
          // Determine plan from price
          const priceId = subscription.items.data[0]?.price?.id;
          const prices = getPriceIds();
          let plan = 'free';
          if (priceId === prices.pro_monthly || priceId === prices.pro_annual) plan = 'pro';
          if (priceId === prices.enterprise_monthly || priceId === prices.enterprise_annual) plan = 'enterprise';

          await db.query(
            `UPDATE tenants
             SET plan = ?, stripe_subscription_id = ?, updated_at = NOW()
             WHERE id = ?`,
            [plan, subscription.id, tenantId],
          );
          console.warn(`[billing] Tenant ${tenantId} subscription updated to ${plan}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenant_id;

        if (tenantId) {
          await db.query(
            `UPDATE tenants
             SET plan = 'free', stripe_subscription_id = NULL, updated_at = NOW()
             WHERE id = ?`,
            [tenantId],
          );
          console.warn(`[billing] Tenant ${tenantId} subscription cancelled — reverted to free`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Find tenant by customer ID and log the failure
        const tenantResult = await db.query(
          'SELECT id FROM tenants WHERE stripe_customer_id = ?',
          [customerId],
        );
        if (tenantResult.rows.length > 0) {
          const tenantId = (tenantResult.rows[0] as Record<string, unknown>).id as string;
          console.warn(`[billing] Payment failed for tenant ${tenantId} — invoice ${invoice.id}`);

          // Log to audit
          await db.query(
            `INSERT INTO audit_log_v2 (tenant_id, action, resource_type, details)
             VALUES (?, 'payment_failed', 'billing', ?)`,
            [tenantId, JSON.stringify({ invoice_id: invoice.id, amount_due: invoice.amount_due })],
          ).catch(() => {});
        }
        break;
      }
    }

    return c.json({ received: true });
  });
}
