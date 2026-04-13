-- Migration 037: Hermes per-turn outcome signal — SQLite edition
--
-- Backs POST /api/hermes/outcomes, the brief-shaped endpoint added in
-- response to HIPP0_REQUESTS.md §6 during the H6 Tier 2 live-smoke run.
-- This is NOT the same as /api/outcomes, which is the compile-request +
-- alignment-analysis flow (see packages/server/src/routes/outcomes.ts).
--
-- This endpoint is the snippet-level reinforcement signal the Hermes
-- persistent-agents brief originally specified: the Python provider's
-- Hipp0MemoryProvider.record_outcome() writes one row here per
-- end-of-turn reaction or auto-detected signal, keyed by the
-- opaque session_id returned from /api/hermes/session/start.
--
-- session_id is intentionally NOT a foreign key — captures can arrive
-- via WAL replay long after the session row has been archived, and the
-- Python provider already treats session_id as an opaque token.
--
-- See supabase/migrations/055_hermes_outcomes.sql for the Postgres mirror.

CREATE TABLE IF NOT EXISTS hermes_outcomes (
  id                TEXT NOT NULL PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id        TEXT NOT NULL,                           -- opaque, not FK
  outcome           TEXT NOT NULL
                    CHECK (outcome IN ('positive', 'neutral', 'negative')),
  snippet_ids_json  TEXT NOT NULL DEFAULT '[]',              -- JSON array of snippet uuids
  signal_source     TEXT NOT NULL,                           -- free-form label, e.g. telegram_reaction
  note              TEXT,                                    -- optional free-form context
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_project_time
  ON hermes_outcomes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_session
  ON hermes_outcomes (session_id);
