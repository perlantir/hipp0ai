-- Reflection Runs: Auto-improvement loops (hourly/daily/weekly)
CREATE TABLE IF NOT EXISTS reflection_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reflection_type TEXT NOT NULL CHECK (reflection_type IN ('hourly', 'daily', 'weekly')),
  results JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reflection_runs_project
  ON reflection_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflection_runs_type
  ON reflection_runs(project_id, reflection_type, started_at DESC);
