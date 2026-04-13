-- A/B Testing: Decision Experiments
CREATE TABLE IF NOT EXISTS decision_experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  decision_a_id UUID NOT NULL REFERENCES decisions(id),
  decision_b_id UUID NOT NULL REFERENCES decisions(id),
  traffic_split REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled')),
  winner TEXT CHECK (winner IN ('a', 'b', 'inconclusive')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON decision_experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON decision_experiments(status);
