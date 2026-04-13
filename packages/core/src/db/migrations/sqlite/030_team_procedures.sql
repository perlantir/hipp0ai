-- Migration 030: Team Procedures — SQLite edition
-- Reusable agent-sequence procedures extracted from repeated workflows in
-- compile_history. TEXT[] columns are stored as JSON-serialised TEXT.

CREATE TABLE IF NOT EXISTS team_procedures (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT '',
  agent_sequence    TEXT NOT NULL DEFAULT '[]',
  trigger_tags      TEXT DEFAULT '[]',
  trigger_domain    TEXT,
  evidence_count    INTEGER NOT NULL DEFAULT 0,
  success_count     INTEGER NOT NULL DEFAULT 0,
  total_executions  INTEGER NOT NULL DEFAULT 0,
  auto_extracted    INTEGER DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procedures_project ON team_procedures(project_id);
CREATE INDEX IF NOT EXISTS idx_procedures_domain ON team_procedures(trigger_domain);
