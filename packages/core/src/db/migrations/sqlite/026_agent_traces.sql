-- Agent Traces: Broader Stigmergy (implicit trace capture) — SQLite
CREATE TABLE IF NOT EXISTS agent_traces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
  metadata TEXT DEFAULT '{}',
  source TEXT DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_traces_project_time
  ON agent_traces(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_agent
  ON agent_traces(agent_name);
CREATE INDEX IF NOT EXISTS idx_traces_type
  ON agent_traces(project_id, trace_type, created_at DESC);
