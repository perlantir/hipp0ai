-- Decision links — bidirectional PR↔decision tracking
CREATE TABLE IF NOT EXISTS decision_links (
  id TEXT NOT NULL PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  platform TEXT NOT NULL DEFAULT 'github',
  external_id TEXT NOT NULL,
  external_url TEXT,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'implements', 'references', 'created_by', 'validates', 'affects'
  )),

  title TEXT,
  status TEXT DEFAULT 'open',
  author TEXT,
  linked_by TEXT DEFAULT 'auto',

  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(decision_id, platform, external_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_links_decision ON decision_links(decision_id);
CREATE INDEX IF NOT EXISTS idx_links_project ON decision_links(project_id);
CREATE INDEX IF NOT EXISTS idx_links_external ON decision_links(platform, external_id);
