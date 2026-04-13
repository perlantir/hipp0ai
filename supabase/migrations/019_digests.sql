-- Feature 6: Proactive Decision Intelligence — Weekly Digests
CREATE TABLE IF NOT EXISTS digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]',
  summary JSONB NOT NULL DEFAULT '{}',
  delivered_dashboard BOOLEAN DEFAULT false,
  delivered_email BOOLEAN DEFAULT false,
  delivered_webhook BOOLEAN DEFAULT false,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_digests_project ON digests(project_id, generated_at DESC);
