-- Migration 032: Collaboration Features — SQLite edition
-- Comments, approvals, and annotations on decisions. TIMESTAMPTZ => TEXT,
-- UUID => TEXT, TEXT[] => JSON TEXT, JSONB => TEXT.

CREATE TABLE IF NOT EXISTS decision_comments (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id        TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  parent_comment_id  TEXT REFERENCES decision_comments(id) ON DELETE CASCADE,
  author             TEXT NOT NULL,
  content            TEXT NOT NULL,
  edited             INTEGER NOT NULL DEFAULT 0,
  deleted_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_decision ON decision_comments(decision_id);
CREATE INDEX IF NOT EXISTS idx_comments_project_time ON decision_comments(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decision_approvals (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id       TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  requested_by      TEXT NOT NULL,
  approvers         TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by       TEXT,
  rejected_by       TEXT,
  rejection_reason  TEXT,
  comment           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_decision ON decision_approvals(decision_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON decision_approvals(status);

CREATE TABLE IF NOT EXISTS decision_annotations (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id  TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  author       TEXT NOT NULL,
  text_range   TEXT NOT NULL DEFAULT '{}',
  note         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotations_decision ON decision_annotations(decision_id);
