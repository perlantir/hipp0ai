-- Relevance Feedback Loop — enhanced feedback + weight history
-- Depends on: 001_initial_schema.sql (relevance_feedback, agents tables)

-- Add rating column to existing relevance_feedback table
ALTER TABLE relevance_feedback ADD COLUMN IF NOT EXISTS
  rating TEXT CHECK (rating IN ('useful', 'irrelevant', 'critical', 'missing'));

ALTER TABLE relevance_feedback ADD COLUMN IF NOT EXISTS
  task_description TEXT;

ALTER TABLE relevance_feedback ADD COLUMN IF NOT EXISTS
  notes TEXT;

-- Weight history for tracking evolution
CREATE TABLE IF NOT EXISTS weight_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  weights_before JSONB NOT NULL,
  weights_after JSONB NOT NULL,
  adjustments JSONB NOT NULL,
  feedback_count INTEGER NOT NULL DEFAULT 0,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_history_agent ON weight_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_weight_history_time ON weight_history(applied_at);
