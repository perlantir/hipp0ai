-- Feature 6: Proactive Decision Intelligence — Weekly Digests
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  findings TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}',
  delivered_dashboard INTEGER DEFAULT 0,
  delivered_email INTEGER DEFAULT 0,
  delivered_webhook INTEGER DEFAULT 0,
  generated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_digests_project ON digests(project_id, generated_at);
