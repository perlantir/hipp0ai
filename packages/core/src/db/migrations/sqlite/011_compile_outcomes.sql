-- Compile Outcomes — passive feedback loop for weight evolution
CREATE TABLE IF NOT EXISTS compile_outcomes (
  id TEXT PRIMARY KEY,
  compile_history_id TEXT NOT NULL REFERENCES compile_history(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_completed INTEGER,
  task_duration_ms INTEGER,
  error_occurred INTEGER DEFAULT 0,
  error_message TEXT,
  decisions_compiled INTEGER NOT NULL DEFAULT 0,
  decisions_referenced INTEGER DEFAULT 0,
  decisions_ignored INTEGER DEFAULT 0,
  decisions_contradicted INTEGER DEFAULT 0,
  alignment_score REAL,
  contradiction_score REAL,
  output_hash TEXT,
  output_length INTEGER,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outcomes_compile ON compile_outcomes(compile_history_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_agent ON compile_outcomes(agent_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_project ON compile_outcomes(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_alignment ON compile_outcomes(agent_id, alignment_score);
