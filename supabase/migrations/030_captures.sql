-- Migration 029: Passive decision capture table
-- Stores background extraction jobs from agent conversations

CREATE TABLE IF NOT EXISTS captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  session_id UUID,
  source TEXT NOT NULL DEFAULT 'api',
  conversation_text TEXT NOT NULL,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  extracted_decision_ids UUID[] DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_captures_project ON captures(project_id);
CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);

-- Extend the decisions source CHECK constraint to allow 'auto_capture'
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_source_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_source_check
  CHECK (source IN ('manual', 'auto_distilled', 'imported', 'auto_capture'));
