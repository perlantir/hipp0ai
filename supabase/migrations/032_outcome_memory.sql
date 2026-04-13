-- Migration 032: Decision Outcome Memory
-- Links outcomes to specific decisions for historical learning

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  compile_history_id UUID,
  task_session_id UUID,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('success', 'failure', 'regression', 'partial', 'reversed', 'unknown')),
  outcome_score FLOAT NOT NULL DEFAULT 0.5 CHECK (outcome_score >= 0 AND outcome_score <= 1),
  reversal BOOLEAN NOT NULL DEFAULT false,
  reversal_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_decision ON decision_outcomes (decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_project ON decision_outcomes (project_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_created ON decision_outcomes (created_at DESC);

-- Cached aggregate columns on decisions for compiler performance
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS outcome_success_rate FLOAT DEFAULT NULL;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS outcome_count INT DEFAULT 0;
