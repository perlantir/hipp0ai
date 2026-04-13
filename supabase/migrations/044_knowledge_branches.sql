-- Knowledge Branching ("Git for Decisions")
-- Allows forking the decision graph, experimenting on a branch,
-- and merging winners back into the main trunk.

ALTER TABLE decisions ADD COLUMN IF NOT EXISTS branch_id UUID;
CREATE INDEX IF NOT EXISTS idx_decisions_branch ON decisions(branch_id) WHERE branch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS decision_branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  merged_at TIMESTAMPTZ,
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_decision_branches_project
  ON decision_branches(project_id);
CREATE INDEX IF NOT EXISTS idx_decision_branches_status
  ON decision_branches(project_id, status);
