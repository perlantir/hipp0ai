-- Import Wizard: scan results tracking
CREATE TABLE IF NOT EXISTS import_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('github', 'slack', 'linear', 'files')),
  status TEXT NOT NULL DEFAULT 'scanning' CHECK (status IN ('scanning', 'complete', 'error')),
  config JSONB NOT NULL DEFAULT '{}',
  stats JSONB NOT NULL DEFAULT '{}',
  preview_decisions JSONB NOT NULL DEFAULT '[]',
  detected_team JSONB NOT NULL DEFAULT '[]',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Collaboration rooms
CREATE TABLE IF NOT EXISTS collab_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID,
  share_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  task_description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  is_public BOOLEAN NOT NULL DEFAULT true,
  max_participants INT NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collab_rooms_token ON collab_rooms(share_token);
CREATE INDEX IF NOT EXISTS idx_collab_rooms_project ON collab_rooms(project_id);

-- Room participants
CREATE TABLE IF NOT EXISTS collab_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'human' CHECK (sender_type IN ('human', 'agent')),
  platform TEXT NOT NULL DEFAULT 'browser' CHECK (platform IN ('browser', 'openclaw', 'mcp', 'sdk', 'api')),
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'operator', 'viewer')),
  is_online BOOLEAN NOT NULL DEFAULT true,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collab_participants_room ON collab_participants(room_id);

-- Room messages
CREATE TABLE IF NOT EXISTS collab_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'chat' CHECK (message_type IN ('chat', 'step_comment', 'suggestion', 'action', 'system')),
  step_id UUID,
  mentions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_messages_room ON collab_messages(room_id);

-- Room timeline steps
CREATE TABLE IF NOT EXISTS collab_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_role TEXT NOT NULL DEFAULT '',
  output_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('in_progress', 'complete')),
  comments_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_steps_room ON collab_steps(room_id);
