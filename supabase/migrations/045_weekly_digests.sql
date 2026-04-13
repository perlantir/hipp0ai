-- Memory Analytics: Weekly Digests storage
--
-- Stores generated weekly digest snapshots for a project so they can be
-- retrieved historically (dashboard, Slack/email delivery, audit).
-- This is a separate table from the older `digests` table (migration 019)
-- and is consumed by the newer memory-analytics reporting system.

CREATE TABLE IF NOT EXISTS weekly_digests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  digest_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digests_project ON weekly_digests(project_id, created_at DESC);
