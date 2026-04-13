-- Audit Log & API Keys — SQLite edition
--
-- PostgreSQL → SQLite conversions applied:
--   UUID PRIMARY KEY DEFAULT uuid_generate_v4() → TEXT PRIMARY KEY
--   TIMESTAMPTZ NOT NULL DEFAULT NOW()          → TEXT NOT NULL DEFAULT (datetime('now'))
--   TIMESTAMPTZ (nullable)                      → TEXT
--   JSONB NOT NULL DEFAULT '{}'                 → TEXT NOT NULL DEFAULT '{}'
--   TEXT[] NOT NULL DEFAULT '{read,write}'      → TEXT NOT NULL DEFAULT '["read","write"]'

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT NOT NULL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  agent_id    TEXT,
  project_id  TEXT,
  decision_id TEXT,
  details     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type    ON audit_log(event_type);

-- ============================================================
-- API KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT NOT NULL PRIMARY KEY,
  key_hash    TEXT NOT NULL UNIQUE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  scopes      TEXT NOT NULL DEFAULT '["read","write"]',
  last_used_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT
);
