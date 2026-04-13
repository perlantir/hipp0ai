-- 025: Temporal Decision Intelligence
-- Time-bounded decisions, supersession chains, temporal scoping

-- Add temporal columns to decisions
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP DEFAULT NOW();
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES decisions(id);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS temporal_scope VARCHAR(20) DEFAULT 'permanent';

-- Indexes for temporal queries
CREATE INDEX IF NOT EXISTS idx_decisions_valid_range ON decisions(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_decisions_superseded_by ON decisions(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decisions_temporal_scope ON decisions(temporal_scope);

-- Constraint: only valid temporal scopes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'decisions_temporal_scope_check'
  ) THEN
    ALTER TABLE decisions ADD CONSTRAINT decisions_temporal_scope_check
      CHECK (temporal_scope IN ('permanent', 'sprint', 'experiment', 'deprecated'));
  END IF;
END $$;

-- Backfill: existing decisions get valid_from = created_at
UPDATE decisions SET valid_from = created_at WHERE valid_from IS NULL;
