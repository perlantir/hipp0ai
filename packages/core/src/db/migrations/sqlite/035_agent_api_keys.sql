-- Per-Agent API Keys — SQLite edition
--
-- Adds agent_id + agent_name columns to the existing api_keys table so
-- each agent can have its own credential. The table and all other
-- columns (last_used_at, revoked_at, project_id, etc.) already exist
-- from 002_audit_log.sql + 022_full_parity.sql.
--
-- This migration is idempotent in that the file is tracked in the
-- _hipp0_migrations table and only run once.

ALTER TABLE api_keys ADD COLUMN agent_id TEXT;
ALTER TABLE api_keys ADD COLUMN agent_name TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);
