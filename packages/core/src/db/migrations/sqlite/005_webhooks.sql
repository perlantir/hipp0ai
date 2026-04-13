-- Webhook configuration — SQLite edition
--
-- PostgreSQL → SQLite conversions:
--   UUID PRIMARY KEY DEFAULT uuid_generate_v4() → TEXT PRIMARY KEY
--   TEXT[] NOT NULL DEFAULT '{}'                → TEXT NOT NULL DEFAULT '[]' (JSON array)
--   BOOLEAN NOT NULL DEFAULT true               → INTEGER NOT NULL DEFAULT 1
--   JSONB NOT NULL DEFAULT '{}'                 → TEXT NOT NULL DEFAULT '{}'
--   TIMESTAMPTZ NOT NULL DEFAULT NOW()          → TEXT NOT NULL DEFAULT (datetime('now'))
--   Trigger using update_updated_at() function  → inline AFTER UPDATE trigger
--
-- Depends on: 001_initial_schema.sql (projects table)

CREATE TABLE IF NOT EXISTS webhook_configs (
  id          TEXT NOT NULL PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'generic'
    CHECK (platform IN ('generic', 'slack', 'discord', 'telegram')),
  events      TEXT NOT NULL DEFAULT '[]',
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  secret      TEXT,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_webhook_configs_project ON webhook_configs(project_id);

CREATE TRIGGER IF NOT EXISTS trg_webhook_configs_updated
  AFTER UPDATE ON webhook_configs
  FOR EACH ROW
BEGIN
  UPDATE webhook_configs SET updated_at = datetime('now') WHERE id = NEW.id;
END;
