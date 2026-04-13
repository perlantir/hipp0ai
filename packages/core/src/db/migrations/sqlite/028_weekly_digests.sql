-- Memory Analytics: Weekly Digests storage — SQLite edition
--
-- Mirrors supabase/migrations/045_weekly_digests.sql. Stores generated
-- weekly digest snapshots for a project. Separate from the older
-- `digests` table created in 014_digests.sql — this one is consumed
-- by the newer memory-analytics reporting system.

CREATE TABLE IF NOT EXISTS weekly_digests (
  id           TEXT NOT NULL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  digest_data  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_digests_project ON weekly_digests(project_id, created_at DESC);
