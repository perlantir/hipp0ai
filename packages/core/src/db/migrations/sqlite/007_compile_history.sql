-- Compile History — SQLite edition
-- Depends on: 001_initial_schema.sql (projects, agents tables)

CREATE TABLE IF NOT EXISTS compile_history (
  id                TEXT NOT NULL PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_name        TEXT NOT NULL,
  task_description  TEXT NOT NULL,
  compiled_at       TEXT NOT NULL DEFAULT (datetime('now')),
  decision_ids      TEXT NOT NULL DEFAULT '[]',
  decision_scores   TEXT NOT NULL DEFAULT '[]',
  total_decisions   INTEGER NOT NULL DEFAULT 0,
  token_budget_used INTEGER NOT NULL DEFAULT 0,
  context_hash      TEXT NOT NULL,
  metadata          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_compile_history_project ON compile_history(project_id);
CREATE INDEX IF NOT EXISTS idx_compile_history_agent ON compile_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_compile_history_time ON compile_history(compiled_at);
