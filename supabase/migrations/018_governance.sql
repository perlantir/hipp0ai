-- Feature 5: Decision Policies & Governance
-- PostgreSQL migration

CREATE TABLE IF NOT EXISTS decision_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  enforcement TEXT NOT NULL DEFAULT 'advisory'
    CHECK (enforcement IN ('advisory', 'warn', 'block')),
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approval_notes TEXT,
  requires_approval_from TEXT[] DEFAULT '{}',
  applies_to TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'general'
    CHECK (category IN ('architecture', 'security', 'process', 'compliance', 'general')),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(decision_id)
);

CREATE TABLE IF NOT EXISTS policy_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES decision_policies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id),
  agent_id UUID REFERENCES agents(id),
  agent_name TEXT,
  compile_history_id UUID REFERENCES compile_history(id),
  outcome_id UUID,
  violation_type TEXT NOT NULL
    CHECK (violation_type IN ('contradiction', 'omission', 'override')),
  description TEXT NOT NULL,
  severity TEXT NOT NULL
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  evidence TEXT,
  status TEXT DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed', 'escalated')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_project ON decision_policies(project_id);
CREATE INDEX IF NOT EXISTS idx_policies_decision ON decision_policies(decision_id);
CREATE INDEX IF NOT EXISTS idx_policies_active ON decision_policies(project_id, active);
CREATE INDEX IF NOT EXISTS idx_violations_project ON policy_violations(project_id);
CREATE INDEX IF NOT EXISTS idx_violations_open ON policy_violations(project_id, status);
CREATE INDEX IF NOT EXISTS idx_violations_policy ON policy_violations(policy_id);
