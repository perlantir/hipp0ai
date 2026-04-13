-- Migration 033: LLM Cost Tracking — SQLite edition
-- Per-call usage log so operators can see exactly where their LLM spend
-- went and the cost-tracker module can enforce per-project daily budget
-- caps. TIMESTAMPTZ => TEXT, UUID => TEXT, REAL for cost (4-byte float is
-- plenty for USD values that are bounded by any sane budget).

CREATE TABLE IF NOT EXISTS llm_usage (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openrouter', 'local')),
  model          TEXT NOT NULL,
  operation      TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_project_time
  ON llm_usage(project_id, created_at DESC);
