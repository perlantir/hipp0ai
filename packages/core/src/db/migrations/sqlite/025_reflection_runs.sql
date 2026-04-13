-- Reflection Runs: Auto-improvement loops (hourly/daily/weekly) — SQLite
CREATE TABLE IF NOT EXISTS reflection_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reflection_type TEXT NOT NULL CHECK (reflection_type IN ('hourly', 'daily', 'weekly')),
  results TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reflection_runs_project
  ON reflection_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflection_runs_type
  ON reflection_runs(project_id, reflection_type, started_at DESC);
