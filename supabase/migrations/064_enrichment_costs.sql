-- Daily cost tracking for entity enrichment
CREATE TABLE IF NOT EXISTS enrichment_cost_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  date TEXT NOT NULL,
  cost_usd DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL,
  entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enrichment_cost_project_date ON enrichment_cost_log(project_id, date);
