-- Migration 048: Digest Delivery
-- Per-project delivery configuration for weekly memory digests.
-- Each row wires a single project up to one delivery channel — email,
-- Slack webhook, or a generic outbound webhook. The scheduler consults
-- this table after generating a digest and dispatches via
-- `deliverDigest()` in @hipp0/core/intelligence/digest-delivery.
--
-- `config` is transport-specific JSON:
--   email   → { recipients: string[], smtp: { host, port, user, pass, from } }
--   slack   → { webhook_url: string }
--   webhook → { url: string, secret?: string }

CREATE TABLE IF NOT EXISTS digest_delivery_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('email', 'slack', 'webhook')),
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digest_delivery_project ON digest_delivery_config(project_id);
