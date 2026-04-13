-- Autonomous Evolution Engine — SQLite equivalent
CREATE TABLE IF NOT EXISTS evolution_proposals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'overridden')),
  affected_decision_ids TEXT DEFAULT '[]',
  reasoning TEXT NOT NULL,
  suggested_action TEXT,
  llm_explanation TEXT,
  confidence REAL NOT NULL,
  impact_score REAL NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution_notes TEXT,
  scan_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evolution_scans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'rule',
  proposals_generated INTEGER DEFAULT 0,
  scan_duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evo_proposals_project_status ON evolution_proposals(project_id, status);
CREATE INDEX IF NOT EXISTS idx_evo_proposals_urgency ON evolution_proposals(urgency);
CREATE INDEX IF NOT EXISTS idx_evo_scans_project ON evolution_scans(project_id);
