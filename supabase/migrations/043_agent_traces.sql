-- Agent Traces: Broader Stigmergy (implicit trace capture)
CREATE TABLE IF NOT EXISTS agent_traces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  trace_type TEXT NOT NULL CHECK (trace_type IN (
    'tool_call',
    'api_response',
    'error',
    'observation',
    'artifact_created',
    'code_change'
  )),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  source TEXT DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_project_time
  ON agent_traces(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_agent
  ON agent_traces(agent_name);
CREATE INDEX IF NOT EXISTS idx_traces_type
  ON agent_traces(project_id, trace_type, created_at DESC);
