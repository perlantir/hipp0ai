-- 023: Hierarchical decision organization
-- Adds domain, category, and priority_level columns to decisions table
-- for layered context loading and domain-aware scoring.

ALTER TABLE decisions ADD COLUMN IF NOT EXISTS domain VARCHAR(100);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS priority_level INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions(domain);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
CREATE INDEX IF NOT EXISTS idx_decisions_priority ON decisions(priority_level);
CREATE INDEX IF NOT EXISTS idx_decisions_project_domain_priority ON decisions(project_id, domain, priority_level);

COMMENT ON COLUMN decisions.domain IS 'High-level area: authentication, infrastructure, frontend, database, deployment, testing, security, api, collaboration, general';
COMMENT ON COLUMN decisions.category IS 'Decision type: architecture, tool-choice, rejected-alternative, convention, security-policy, configuration, decision';
COMMENT ON COLUMN decisions.priority_level IS '0=critical (always loaded), 1=standard (default), 2=background (on-demand)';
