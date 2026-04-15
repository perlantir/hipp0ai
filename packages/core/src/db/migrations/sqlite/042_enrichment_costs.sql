-- Daily cost tracking for entity enrichment
CREATE TABLE IF NOT EXISTS enrichment_cost_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  source TEXT NOT NULL,
  entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_enrichment_cost_project_date ON enrichment_cost_log(project_id, date);
