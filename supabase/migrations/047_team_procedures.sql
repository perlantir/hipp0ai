-- Migration 047: Team Procedures
-- Reusable agent-sequence procedures extracted from repeated workflows in
-- compile_history. A procedure captures "for tasks like X, the team has
-- followed agent sequence [A, B, C] N times with X% success".

CREATE TABLE IF NOT EXISTS team_procedures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  agent_sequence TEXT[] NOT NULL,
  trigger_tags TEXT[] DEFAULT '{}',
  trigger_domain TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  total_executions INTEGER NOT NULL DEFAULT 0,
  auto_extracted BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procedures_project ON team_procedures(project_id);
CREATE INDEX IF NOT EXISTS idx_procedures_domain ON team_procedures(trigger_domain);
