-- Evolution Engine Phase 2 — Audit trail columns on evolution_proposals

ALTER TABLE evolution_proposals ADD COLUMN executed_action TEXT;
ALTER TABLE evolution_proposals ADD COLUMN decisions_modified TEXT DEFAULT '[]';
ALTER TABLE evolution_proposals ADD COLUMN executed_at TEXT;
ALTER TABLE evolution_proposals ADD COLUMN executed_by TEXT;
