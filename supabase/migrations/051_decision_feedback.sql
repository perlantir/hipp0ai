-- Migration 051: Decision Feedback (thumbs up/down)
--
-- Captures human/agent feedback on whether compiled decisions were actually
-- useful for downstream tasks. Feeds the relevance-learner so that scoring
-- weights and trust multipliers can be tuned over time.
--
-- The existing `relevance_feedback` table is tightly coupled to agent-scoped
-- weight learning (was_useful boolean, agent_id FK). This table adds a
-- project-scoped, free-text-capable feedback channel with 3-way ratings and
-- usage signals intended for UX-driven feedback (dashboard buttons, MCP
-- replies, etc.).

CREATE TABLE IF NOT EXISTS decision_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  compile_request_id UUID,
  agent_name TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative', 'neutral')),
  usage_signal TEXT CHECK (usage_signal IN ('used', 'mentioned', 'ignored', 'misleading')),
  comment TEXT,
  rated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_decision ON decision_feedback(decision_id);
CREATE INDEX IF NOT EXISTS idx_feedback_project_time ON decision_feedback(project_id, created_at DESC);
