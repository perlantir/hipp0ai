-- Feature 7: Cross-Tenant Pattern Intelligence

-- Opt-in column on projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_anonymous_patterns BOOLEAN DEFAULT false;

-- Anonymous aggregated patterns
CREATE TABLE IF NOT EXISTS anonymous_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'decision_pair', 'decision_sequence', 'contradiction_common', 'gap_indicator'
  )),
  tag_a TEXT NOT NULL,
  title_pattern_a TEXT,
  tag_b TEXT,
  title_pattern_b TEXT,
  occurrence_count INTEGER DEFAULT 0,
  tenant_count INTEGER DEFAULT 0,
  confidence FLOAT DEFAULT 0.0,
  median_gap_days INTEGER,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON anonymous_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_tags ON anonymous_patterns(tag_a, tag_b);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON anonymous_patterns(confidence DESC);

-- Track contributions (prevent double-counting)
CREATE TABLE IF NOT EXISTS pattern_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  pattern_id UUID NOT NULL REFERENCES anonymous_patterns(id),
  contributed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, pattern_id)
);
