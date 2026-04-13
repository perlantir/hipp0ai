-- Cross-Project Pattern Sharing
-- Network effect system: patterns discovered in one project become
-- available to all other projects as anonymous "community patterns".
-- Sharing is strictly opt-in; origin project is identified only by a
-- one-way SHA256 hash so no project IDs leak across tenants.

CREATE TABLE IF NOT EXISTS shared_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_project_hash TEXT NOT NULL, -- anonymized project hash, not ID
  pattern_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT,
  tags TEXT[] DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.5,
  adoption_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shared_patterns_domain ON shared_patterns(domain);
CREATE INDEX IF NOT EXISTS idx_shared_patterns_adoption ON shared_patterns(adoption_count DESC);

CREATE TABLE IF NOT EXISTS pattern_adoptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shared_pattern_id UUID NOT NULL REFERENCES shared_patterns(id) ON DELETE CASCADE,
  adopting_project_hash TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('success', 'failure', 'partial', NULL)),
  adopted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adoptions_pattern ON pattern_adoptions(shared_pattern_id);
