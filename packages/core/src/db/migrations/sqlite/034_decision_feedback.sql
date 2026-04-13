-- Migration 034: Decision Feedback — SQLite edition
--
-- Captures human/agent feedback on whether compiled decisions were actually
-- useful for downstream tasks. Feeds the relevance-learner so scoring weights
-- and trust multipliers can be tuned over time.
--
-- See supabase/migrations/051_decision_feedback.sql for PostgreSQL schema.

CREATE TABLE IF NOT EXISTS decision_feedback (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id        TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  compile_request_id TEXT,
  agent_name         TEXT NOT NULL,
  rating             TEXT NOT NULL CHECK (rating IN ('positive', 'negative', 'neutral')),
  usage_signal       TEXT CHECK (usage_signal IN ('used', 'mentioned', 'ignored', 'misleading')),
  comment            TEXT,
  rated_by           TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_decision ON decision_feedback(decision_id);
CREATE INDEX IF NOT EXISTS idx_feedback_project_time ON decision_feedback(project_id, created_at DESC);
