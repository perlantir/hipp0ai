-- Migration 054: Hermes runtime integration — PostgreSQL edition
--
-- Mirror of packages/core/src/db/migrations/sqlite/036_hermes_agents.sql.
-- See that file for the full rationale.
--
-- Tables:
--   hermes_agents         — persistent named runtime personas
--   hermes_conversations  — one row per Hermes session
--   hermes_messages       — message-level log for the web Chat view
--   hermes_user_facts     — cross-agent per-external-user facts surface

-- ---------------------------------------------------------------------------
-- hermes_agents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hermes_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name     TEXT NOT NULL,
  soul_md        TEXT NOT NULL,
  config_json    JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_agents_project_name
  ON hermes_agents(project_id, agent_name);

-- ---------------------------------------------------------------------------
-- hermes_conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hermes_conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL UNIQUE,
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id           UUID NOT NULL REFERENCES hermes_agents(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL,
  external_user_id   TEXT,
  external_chat_id   TEXT,
  metadata_json      JSONB,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ,
  summary_md         TEXT
);

CREATE INDEX IF NOT EXISTS idx_hermes_conv_agent_started
  ON hermes_conversations(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hermes_conv_project_started
  ON hermes_conversations(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hermes_conv_external_chat
  ON hermes_conversations(external_chat_id);

-- ---------------------------------------------------------------------------
-- hermes_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hermes_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES hermes_conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content           TEXT NOT NULL,
  tool_calls_json   JSONB,
  tool_results_json JSONB,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hermes_msg_conv_time
  ON hermes_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- hermes_user_facts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hermes_user_facts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_user_id  TEXT NOT NULL,
  key               TEXT NOT NULL,
  value             TEXT NOT NULL,
  source            TEXT,
  version           TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_facts_project_user_key
  ON hermes_user_facts(project_id, external_user_id, key);
CREATE INDEX IF NOT EXISTS idx_hermes_facts_project_user
  ON hermes_user_facts(project_id, external_user_id);
