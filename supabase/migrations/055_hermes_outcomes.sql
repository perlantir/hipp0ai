-- Migration 055: Hermes per-turn outcome signal — PostgreSQL edition
--
-- Mirror of packages/core/src/db/migrations/sqlite/037_hermes_outcomes.sql.
-- See that file for the full rationale.
--
-- Backs POST /api/hermes/outcomes — the brief-shaped snippet-level
-- reinforcement signal. Distinct from /api/outcomes, which is the
-- compile-request + alignment-analysis flow.

CREATE TABLE IF NOT EXISTS hermes_outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id        UUID NOT NULL,                           -- opaque, not FK
  outcome           TEXT NOT NULL
                    CHECK (outcome IN ('positive', 'neutral', 'negative')),
  -- Stored as JSONB on Postgres for consistency with the SQLite column of
  -- the same name. The route handler always JSON.stringify()s the array
  -- before passing it down, so both dialects take a single string-typed
  -- parameter — no dialect branching in the INSERT.
  snippet_ids_json  JSONB NOT NULL DEFAULT '[]'::JSONB,
  signal_source     TEXT NOT NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_project_time
  ON hermes_outcomes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_session
  ON hermes_outcomes (session_id);
