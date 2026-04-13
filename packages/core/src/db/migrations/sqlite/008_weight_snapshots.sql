-- Weight snapshots — SQLite edition
-- Depends on: 001_initial_schema.sql (agents table)

CREATE TABLE IF NOT EXISTS weight_snapshots (
  id          TEXT NOT NULL PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  weights     TEXT NOT NULL DEFAULT '{}',
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weight_snapshots_agent ON weight_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_weight_snapshots_time ON weight_snapshots(snapshot_at);
