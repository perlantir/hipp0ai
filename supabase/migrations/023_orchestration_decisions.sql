-- Super Brain Phase 3: Smart Orchestrator — orchestration decision tracking
CREATE TABLE IF NOT EXISTS orchestration_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_sessions(id),
  step_number INTEGER NOT NULL,
  suggested_agent TEXT NOT NULL,
  actual_agent TEXT NOT NULL,
  was_override BOOLEAN DEFAULT false,
  override_reason TEXT,
  suggestion_confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orch_decisions_session ON orchestration_decisions(session_id);
CREATE INDEX idx_orch_decisions_override ON orchestration_decisions(was_override) WHERE was_override = true;
