-- Functions, Triggers & Cleanup — SQLite edition
--
-- PostgreSQL → SQLite conversions:
--   PL/pgSQL stored functions  → not supported in SQLite; implemented in application layer
--   get_connected_decisions()  → no-op / implemented in TypeScript (recursive CTE is
--                                available in SQLite 3.35+ but without the LATERAL join
--                                and ARRAY type; the application layer implements graph
--                                traversal instead)
--   update_updated_at()        → replaced by inline AFTER UPDATE triggers (already
--                                defined in 001_initial_schema.sql for core tables)
--   cleanup_expired_cache()    → no-op SQL function; call implemented as application code
--
-- The relevance_feedback table itself is defined in 001_initial_schema.sql.
-- This migration only adds the "functions/triggers" that 003 was responsible
-- for in PostgreSQL, translated to SQLite equivalents where possible.

-- No additional DDL is required for relevance_feedback.
-- Triggers for updated_at on projects, agents, decisions, artifacts are in 001.

-- Placeholder: cleanup_expired_cache is handled by the application layer.
-- Equivalent SQL (run manually or on a schedule):
--   DELETE FROM context_cache WHERE expires_at < datetime('now');

-- SQLite note: the recursive graph traversal that get_connected_decisions()
-- provides in PostgreSQL can be approximated with a recursive CTE (supported
-- in SQLite ≥ 3.35.0), but it is implemented in TypeScript for portability.

SELECT 1; -- Ensure this file is not empty so the migration runner records it.
