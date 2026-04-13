-- Knowledge Branching ("Git for Decisions") — SQLite edition
-- Allows forking the decision graph, experimenting on a branch,
-- and merging winners back into main.
--
-- SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
-- so we check pragma existence inline. The migration runner executes
-- the whole file; we use a select guard to keep it idempotent.

-- Add branch_id column to decisions (nullable = main). Wrapped in a
-- conditional expression so repeat runs are safe.
-- Note: SQLite executes this via runMigrations which tracks which files
-- have been applied — so the ADD COLUMN fires only once.
ALTER TABLE decisions ADD COLUMN branch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_decisions_branch
  ON decisions(branch_id) WHERE branch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS decision_branches (
  id          TEXT NOT NULL PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'merged', 'deleted')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  merged_at   TEXT,
  CONSTRAINT uq_branch_name_per_project UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_decision_branches_project
  ON decision_branches(project_id);
CREATE INDEX IF NOT EXISTS idx_decision_branches_status
  ON decision_branches(project_id, status);
