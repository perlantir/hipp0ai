-- Session Memory: multi-step task sessions where agents share real outputs
CREATE TABLE IF NOT EXISTS task_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  agents_involved TEXT[] DEFAULT '{}',
  current_step INTEGER DEFAULT 0,
  state_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  agent_role TEXT,
  task_description TEXT NOT NULL,
  output TEXT,
  output_summary TEXT,
  artifacts JSONB DEFAULT '[]',
  decisions_compiled INTEGER DEFAULT 0,
  decisions_created TEXT[] DEFAULT '{}',
  duration_ms INTEGER,
  compile_time_ms INTEGER,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON task_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON task_sessions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_steps_session ON session_steps(session_id, step_number);
CREATE INDEX IF NOT EXISTS idx_steps_agent ON session_steps(agent_name, session_id);
