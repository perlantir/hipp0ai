-- Migration 052: Per-Agent API Keys
--
-- Adds agent-scoped columns to the existing api_keys table so that each
-- agent can have its own credential, distinct from the tenant/project
-- level keys. Revoking a compromised agent's key leaves the rest of the
-- team unaffected.
--
-- The api_keys table already exists from migrations 002 + 012 + 013 with
-- tenant_id, project_id, name, key_hash, key_prefix, permissions, etc.
-- This migration simply adds three new columns + an index and is fully
-- idempotent (safe to run multiple times).

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- last_used_at already exists on api_keys (migration 002 + 012); repeat
-- ADD COLUMN IF NOT EXISTS for environments that may have diverged.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- A column used to mark a revocation without deleting the row. migrations
-- 002 included it under the legacy schema; add idempotently in case the
-- phase3 schema in 012 replaced the table.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);
