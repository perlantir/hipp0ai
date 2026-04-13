-- Relevance Feedback Loop — SQLite edition
-- Add rating column and weight_history table
--
-- Depends on: 001_initial_schema.sql (relevance_feedback, agents tables)

-- SQLite ALTER TABLE can only add one column at a time and has no IF NOT EXISTS
-- Use a safe approach: try to add, ignore if already exists

-- Add rating column (useful/irrelevant/critical/missing)
ALTER TABLE relevance_feedback ADD COLUMN rating TEXT;

-- Add task_description column
ALTER TABLE relevance_feedback ADD COLUMN task_description TEXT;

-- Add notes column
ALTER TABLE relevance_feedback ADD COLUMN notes TEXT;

-- Weight history for tracking evolution
CREATE TABLE IF NOT EXISTS weight_history (
  id              TEXT NOT NULL PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  weights_before  TEXT NOT NULL DEFAULT '{}',
  weights_after   TEXT NOT NULL DEFAULT '{}',
  adjustments     TEXT NOT NULL DEFAULT '{}',
  feedback_count  INTEGER NOT NULL DEFAULT 0,
  applied_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weight_history_agent ON weight_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_weight_history_time ON weight_history(applied_at);
