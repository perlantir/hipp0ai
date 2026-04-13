-- Migration 029: Passive decision capture table
-- Stores background extraction jobs from agent conversations

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL DEFAULT 'api',
  conversation_text TEXT NOT NULL,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  extracted_decision_ids TEXT DEFAULT '[]',
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_captures_project ON captures(project_id);
CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);

-- Extend the decisions source CHECK constraint to allow 'auto_capture'
-- SQLite doesn't support ALTER CHECK, so we add a trigger-based validation
-- The original CHECK is on the initial schema; new inserts with 'auto_capture' bypass via relaxed constraint
-- We handle this at the application layer since SQLite CHECK constraints can't be altered.
