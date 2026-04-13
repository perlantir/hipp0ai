-- Feature 10: Autonomous Decision Evolution
-- Proposals for improving underperforming decisions

CREATE TABLE IF NOT EXISTS decision_evolution_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  proposed_title TEXT NOT NULL,
  proposed_description TEXT NOT NULL,
  proposed_reasoning TEXT NOT NULL,
  proposed_tags TEXT[] DEFAULT '{}',
  proposed_affects TEXT[] DEFAULT '{}',
  trigger_reason TEXT NOT NULL CHECK (trigger_reason IN (
    'low_alignment', 'frequently_contradicted', 'frequently_superseded',
    'stale', 'low_outcome_success', 'manual_request'
  )),
  trigger_data JSONB NOT NULL DEFAULT '{}',
  predicted_impact JSONB NOT NULL DEFAULT '{}',
  simulation_ran BOOLEAN DEFAULT false,
  simulation_results JSONB DEFAULT '{}',
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'expired')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  new_decision_id UUID REFERENCES decisions(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_evolution_project ON decision_evolution_proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_evolution_status ON decision_evolution_proposals(status) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_evolution_original ON decision_evolution_proposals(original_decision_id);
