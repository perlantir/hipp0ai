-- Migration 036: Hermes runtime integration — SQLite edition
--
-- Introduces four tables that back the `/api/hermes/*` namespace:
--
--   hermes_agents         — persistent named runtime personas (alice, bob, …)
--   hermes_conversations  — one row per Hermes session (platform + external
--                           chat binding + lifecycle timestamps)
--   hermes_messages       — optional message-level log used by the Chat view;
--                           raw conversations are also captured via
--                           /api/capture which populates the `captures` table
--                           from earlier migrations. This table is the
--                           dedicated schema for the web Chat view.
--   hermes_user_facts     — per-external-user facts surface, cross-agent.
--
-- See supabase/migrations/054_hermes_agents.sql for the PostgreSQL schema.

-- ---------------------------------------------------------------------------
-- hermes_agents
-- ---------------------------------------------------------------------------
-- One row per persistent Hermes agent profile. Unique on (project_id,
-- agent_name) so alice@project-A and alice@project-B are distinct rows.
CREATE TABLE IF NOT EXISTS hermes_agents (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name     TEXT NOT NULL,
  soul_md        TEXT NOT NULL,        -- SOUL.md content
  config_json    TEXT NOT NULL,        -- JSON: model, toolset, platform_access, …
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_agents_project_name
  ON hermes_agents(project_id, agent_name);

-- ---------------------------------------------------------------------------
-- hermes_conversations
-- ---------------------------------------------------------------------------
-- One row per session. `session_id` is the authoritative UUID used by
-- /api/capture and /api/compile. `external_chat_id` lets us resume Telegram
-- or Discord conversations after a restart.
CREATE TABLE IF NOT EXISTS hermes_conversations (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL UNIQUE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id           TEXT NOT NULL REFERENCES hermes_agents(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL,
  external_user_id   TEXT,
  external_chat_id   TEXT,
  metadata_json      TEXT,
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at           TEXT,
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
-- Individual messages in a Hermes session. The web Chat view paginates over
-- this table. Telegram/Discord traffic is the primary write source; raw
-- capture-style bulk ingest stays in the existing `captures` table.
CREATE TABLE IF NOT EXISTS hermes_messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES hermes_conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content           TEXT NOT NULL,
  tool_calls_json   TEXT,           -- JSON array of tool invocations, if any
  tool_results_json TEXT,           -- JSON array of tool results, if any
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hermes_msg_conv_time
  ON hermes_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- hermes_user_facts
-- ---------------------------------------------------------------------------
-- Cross-agent facts about an external user. When alice learns the user
-- prefers phone calls, bob reads the same fact when the user messages bob.
--
-- `version` acts as an ETag. Clients pass the last-seen version as If-Match;
-- HIPP0 rejects concurrent writes with 409 Conflict.
CREATE TABLE IF NOT EXISTS hermes_user_facts (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_user_id  TEXT NOT NULL,
  key               TEXT NOT NULL,
  value             TEXT NOT NULL,
  source            TEXT,          -- agent_name that learned this fact
  version           TEXT NOT NULL, -- ETag
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_facts_project_user_key
  ON hermes_user_facts(project_id, external_user_id, key);
CREATE INDEX IF NOT EXISTS idx_hermes_facts_project_user
  ON hermes_user_facts(project_id, external_user_id);
