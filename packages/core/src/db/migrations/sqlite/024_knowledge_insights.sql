-- Migration 024: Knowledge Insights (Tier 3) — SQLite edition
-- Distilled team knowledge: reusable procedures, policies, learned rules.
-- Generated from analyzing Tier 2 facts (decisions) rather than raw traces.

CREATE TABLE IF NOT EXISTS knowledge_insights (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('procedure', 'policy', 'anti_pattern', 'domain_rule')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_decision_ids TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  domain TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insights_project ON knowledge_insights(project_id);
CREATE INDEX IF NOT EXISTS idx_insights_type ON knowledge_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_insights_status ON knowledge_insights(status);
CREATE INDEX IF NOT EXISTS idx_insights_domain ON knowledge_insights(domain);
