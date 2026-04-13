-- Migration 049: Collaboration Features
-- Comments, approvals, and annotations on decisions so multiple humans
-- can collaboratively curate a team's decision memory.

CREATE TABLE IF NOT EXISTS decision_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES decision_comments(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  edited BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_decision ON decision_comments(decision_id);
CREATE INDEX IF NOT EXISTS idx_comments_project_time ON decision_comments(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decision_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,
  approvers TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by TEXT,
  rejected_by TEXT,
  rejection_reason TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approvals_decision ON decision_approvals(decision_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON decision_approvals(status);

CREATE TABLE IF NOT EXISTS decision_annotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  text_range JSONB NOT NULL DEFAULT '{}',
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_annotations_decision ON decision_annotations(decision_id);
