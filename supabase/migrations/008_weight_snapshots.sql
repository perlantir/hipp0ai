-- Weight snapshots for true time travel
-- Depends on: 001_initial_schema.sql (agents table)

CREATE TABLE IF NOT EXISTS weight_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  weights JSONB NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_snapshots_agent ON weight_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_weight_snapshots_time ON weight_snapshots(snapshot_at);
