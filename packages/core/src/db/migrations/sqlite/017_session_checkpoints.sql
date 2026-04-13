-- Session Checkpoints — context compression survival
-- Agents save checkpoints before context is trimmed; restored on next compile.

CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  session_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  checkpoint_text TEXT NOT NULL,
  important_decision_ids TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session_agent ON session_checkpoints(session_id, agent_name);
