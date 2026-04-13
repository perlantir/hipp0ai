-- Fix agent role assignments
-- counsel should be 'legal' not 'security'
-- makspm should be 'product' not 'governor'
UPDATE agents SET role = 'legal' WHERE name = 'counsel';
UPDATE agents SET role = 'product' WHERE name = 'makspm';

-- Deactivate test/duplicate agents that are not real OpenClaw agents
-- Using soft-delete via status column to avoid foreign key issues
-- The dashboard should filter these out
UPDATE agents SET role = 'inactive' WHERE name IN ('sentinel', 'polish', 'aegis', 'relay');
