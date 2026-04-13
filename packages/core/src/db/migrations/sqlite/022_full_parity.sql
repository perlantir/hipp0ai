-- Migration 022: Full schema parity with Postgres
-- Brings SQLite in line with Postgres migrations 022-033

-- ============================================================
-- Session memory (Postgres 022)
-- task_sessions was referenced by 017_session_checkpoints but never created
-- ============================================================
CREATE TABLE IF NOT EXISTS task_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  agents_involved TEXT DEFAULT '[]',
  current_step INTEGER DEFAULT 0,
  state_summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS session_steps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  agent_role TEXT,
  task_description TEXT NOT NULL,
  output TEXT,
  output_summary TEXT,
  artifacts TEXT DEFAULT '[]',
  decisions_compiled INTEGER DEFAULT 0,
  decisions_created TEXT DEFAULT '[]',
  duration_ms INTEGER,
  compile_time_ms INTEGER,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  wing TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_sessions_project ON task_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_session_steps_session ON session_steps(session_id, step_number);
CREATE INDEX IF NOT EXISTS idx_session_steps_agent ON session_steps(agent_name, session_id);

-- session_memory table for agent context snapshots
CREATE TABLE IF NOT EXISTS session_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  step_number INTEGER NOT NULL DEFAULT 0,
  context_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- ============================================================
-- Add missing columns to decisions
-- (namespace already added in 018, review_status in 009)
-- ============================================================
ALTER TABLE decisions ADD COLUMN priority_level INTEGER DEFAULT 1;
ALTER TABLE decisions ADD COLUMN valid_from TEXT;
ALTER TABLE decisions ADD COLUMN valid_until TEXT;
ALTER TABLE decisions ADD COLUMN temporal_scope TEXT DEFAULT 'permanent' CHECK (temporal_scope IN ('permanent', 'sprint', 'experiment', 'deprecated'));
ALTER TABLE decisions ADD COLUMN wing TEXT;
ALTER TABLE decisions ADD COLUMN superseded_by TEXT;
ALTER TABLE decisions ADD COLUMN provenance_chain TEXT DEFAULT '[]';
ALTER TABLE decisions ADD COLUMN trust_score REAL;
ALTER TABLE decisions ADD COLUMN outcome_success_rate REAL;
ALTER TABLE decisions ADD COLUMN outcome_count INTEGER DEFAULT 0;

-- ============================================================
-- Add missing columns to agents (Postgres 026)
-- ============================================================
ALTER TABLE agents ADD COLUMN wing_affinity TEXT DEFAULT '{}';
ALTER TABLE agents ADD COLUMN primary_domain TEXT;

-- ============================================================
-- Decision outcomes table (Postgres 032)
-- ============================================================
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  compile_history_id TEXT,
  task_session_id TEXT,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('success', 'failure', 'regression', 'partial', 'reversed', 'unknown')),
  outcome_score REAL NOT NULL DEFAULT 0.5 CHECK (outcome_score >= 0 AND outcome_score <= 1),
  reversal INTEGER NOT NULL DEFAULT 0,
  reversal_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}',
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ============================================================
-- Add remaining missing columns to decisions
-- (domain, category, stale, last_referenced_at, reference_count,
--  trust_components, embedding)
-- ============================================================
ALTER TABLE decisions ADD COLUMN domain TEXT;
ALTER TABLE decisions ADD COLUMN category TEXT DEFAULT 'general';
ALTER TABLE decisions ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decisions ADD COLUMN last_referenced_at TEXT;
ALTER TABLE decisions ADD COLUMN reference_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decisions ADD COLUMN trust_components TEXT DEFAULT '{}';
ALTER TABLE decisions ADD COLUMN embedding TEXT;

-- ============================================================
-- Add missing columns to api_keys
-- (tenant_id, key_prefix, permissions, rate_limit, created_by, expires_at)
-- ============================================================
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT;
ALTER TABLE api_keys ADD COLUMN key_prefix TEXT;
ALTER TABLE api_keys ADD COLUMN permissions TEXT DEFAULT 'read';
ALTER TABLE api_keys ADD COLUMN rate_limit INTEGER DEFAULT 100;
ALTER TABLE api_keys ADD COLUMN created_by TEXT;
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;

-- ============================================================
-- Daily usage table
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_usage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  date TEXT NOT NULL,
  compile_count INTEGER DEFAULT 0,
  ask_count INTEGER DEFAULT 0,
  decision_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_usage_tenant_date ON daily_usage(tenant_id, date);

-- ============================================================
-- Audit log v2 table (used by team, billing, api-keys routes)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log_v2 (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  tenant_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_v2_tenant ON audit_log_v2(tenant_id, created_at DESC);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_decision_sqlite ON decision_outcomes (decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_project_sqlite ON decision_outcomes (project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_wing_sqlite ON decisions (wing);
CREATE INDEX IF NOT EXISTS idx_decisions_temporal_sqlite ON decisions (temporal_scope);
CREATE INDEX IF NOT EXISTS idx_decisions_trust_sqlite ON decisions (trust_score);
CREATE INDEX IF NOT EXISTS idx_decisions_domain_sqlite ON decisions (domain);
CREATE INDEX IF NOT EXISTS idx_decisions_stale_sqlite ON decisions (stale);
