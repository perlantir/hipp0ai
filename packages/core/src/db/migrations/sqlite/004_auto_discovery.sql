-- Auto-discovery Tables — SQLite edition
--
-- PostgreSQL → SQLite conversions:
--   UUID PRIMARY KEY DEFAULT uuid_generate_v4() → TEXT PRIMARY KEY
--   TIMESTAMPTZ NOT NULL DEFAULT NOW()          → TEXT NOT NULL DEFAULT (datetime('now'))
--   TIMESTAMPTZ (nullable)                      → TEXT
--   JSONB NOT NULL DEFAULT '{}'                 → TEXT NOT NULL DEFAULT '{}'
--   BOOLEAN NOT NULL DEFAULT true               → INTEGER NOT NULL DEFAULT 1
--   Trigger using update_updated_at() function  → inline AFTER UPDATE trigger
--
-- Depends on: 001_initial_schema.sql (projects table)

-- ============================================================
-- PROCESSED SOURCES
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_sources (
  id                  TEXT    NOT NULL PRIMARY KEY,
  project_id          TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id           TEXT    NOT NULL,
  connector_name      TEXT    NOT NULL,
  processed_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  decisions_extracted INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  metadata            TEXT    NOT NULL DEFAULT '{}',
  CONSTRAINT uq_source_per_project UNIQUE(project_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_sources_project   ON processed_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_processed_sources_connector ON processed_sources(connector_name);

-- ============================================================
-- CONNECTOR CONFIGS
-- ============================================================
CREATE TABLE IF NOT EXISTS connector_configs (
  id             TEXT    NOT NULL PRIMARY KEY,
  project_id     TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connector_name TEXT    NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  config         TEXT    NOT NULL DEFAULT '{}',
  last_poll_at   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_connector_per_project UNIQUE(project_id, connector_name)
);

CREATE TRIGGER IF NOT EXISTS trg_connector_configs_updated
  AFTER UPDATE ON connector_configs
  FOR EACH ROW
BEGIN
  UPDATE connector_configs SET updated_at = datetime('now') WHERE id = NEW.id;
END;
