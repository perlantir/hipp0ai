-- Migration 038: Composite index on decision_edges(source_id, target_id)
--
-- Speeds up the batched neighbor fetch in context-compiler's
-- expandGraphContext (packages/core/src/context-compiler/index.ts).
-- The compile path now issues a single
--   SELECT source_id, target_id FROM decision_edges
--    WHERE source_id IN (...) OR target_id IN (...)
-- for every compile call. Without an index on source_id/target_id this
-- degrades to a full table scan; with this composite index SQLite can
-- satisfy either branch via the index.
--
-- See supabase/migrations/057_decision_edges_index.sql for the Postgres mirror.

CREATE INDEX IF NOT EXISTS idx_decision_edges_source_target
  ON decision_edges (source_id, target_id);
