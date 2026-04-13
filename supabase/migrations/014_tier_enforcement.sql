-- Phase 6: Tier Enforcement — daily usage tracking + Stripe fields on tenants
-- Creates daily_usage table for tracking compile/ask/decision counts per tenant per day.
-- Adds stripe_customer_id and stripe_subscription_id to tenants table.

-- Daily usage counters (reset daily by date partition)
CREATE TABLE IF NOT EXISTS daily_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  compiles_count INTEGER NOT NULL DEFAULT 0,
  ask_count INTEGER NOT NULL DEFAULT 0,
  decisions_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, date)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_usage_tenant_date ON daily_usage(tenant_id, date DESC);

-- Stripe fields on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Index for Stripe customer lookups
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
