-- Migration 031: Digest Delivery — SQLite edition
-- Mirrors supabase/migrations/048_digest_delivery.sql. Stores per-project
-- weekly-digest delivery config (email / slack / webhook) consumed by the
-- scheduler and the digest-delivery module in @hipp0/core.
--
-- SQLite does not have JSONB or TIMESTAMPTZ, so we store `config` as JSON in
-- a TEXT column and timestamps as ISO-8601 TEXT.

CREATE TABLE IF NOT EXISTS digest_delivery_config (
  id            TEXT NOT NULL PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('email', 'slack', 'webhook')),
  config        TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_sent_at  TEXT,
  last_status   TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_digest_delivery_project ON digest_delivery_config(project_id);
