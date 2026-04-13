-- Autonomous Evolution Engine — proposals + scan tracking
-- Adds new tables for rule-based evolution scanning

CREATE TABLE IF NOT EXISTS evolution_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'overridden')),
  affected_decision_ids UUID[] DEFAULT '{}',
  reasoning TEXT NOT NULL,
  suggested_action TEXT,
  llm_explanation TEXT,
  confidence FLOAT NOT NULL,
  impact_score FLOAT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  scan_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evolution_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'rule',
  proposals_generated INTEGER DEFAULT 0,
  scan_duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_project_status ON evolution_proposals(project_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_urgency ON evolution_proposals(urgency);
CREATE INDEX IF NOT EXISTS idx_scans_project ON evolution_scans(project_id);
