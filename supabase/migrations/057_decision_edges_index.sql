-- Migration 057: Composite index on decision_edges(source_id, target_id)
--
-- Mirror of packages/core/src/db/migrations/sqlite/038_decision_edges_index.sql.
-- Speeds up the batched neighbor fetch in context-compiler's
-- expandGraphContext, which now issues a single
--   SELECT source_id, target_id FROM decision_edges
--    WHERE source_id IN (...) OR target_id IN (...)
-- per compile. The composite index covers both sides of the OR via the
-- leading column and a target_id-only scan on the alternative branch
-- (the planner may add a secondary scan on target_id; Postgres bitmap-ors
-- multiple index scans well).

CREATE INDEX IF NOT EXISTS idx_decision_edges_source_target
  ON decision_edges (source_id, target_id);
