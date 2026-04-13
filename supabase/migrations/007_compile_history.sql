-- Compile History — records every context compilation for time travel
-- Depends on: 001_initial_schema.sql (projects, agents tables)

CREATE TABLE IF NOT EXISTS compile_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  task_description TEXT NOT NULL,
  compiled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision_ids UUID[] NOT NULL DEFAULT '{}',
  decision_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_decisions INTEGER NOT NULL DEFAULT 0,
  token_budget_used INTEGER NOT NULL DEFAULT 0,
  context_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_compile_history_project ON compile_history(project_id);
CREATE INDEX IF NOT EXISTS idx_compile_history_agent ON compile_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_compile_history_time ON compile_history(compiled_at);
