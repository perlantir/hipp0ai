-- A/B Testing: Decision Experiments (SQLite)
CREATE TABLE IF NOT EXISTS decision_experiments (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  decision_a_id TEXT NOT NULL REFERENCES decisions(id),
  decision_b_id TEXT NOT NULL REFERENCES decisions(id),
  traffic_split REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled')),
  winner TEXT CHECK (winner IN ('a', 'b', 'inconclusive')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON decision_experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON decision_experiments(status);
