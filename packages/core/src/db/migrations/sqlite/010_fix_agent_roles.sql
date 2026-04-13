-- Fix agent role assignments (SQLite)
UPDATE agents SET role = 'legal' WHERE name = 'counsel';
UPDATE agents SET role = 'product' WHERE name = 'makspm';

-- Deactivate test/duplicate agents
UPDATE agents SET role = 'inactive' WHERE name IN ('sentinel', 'polish', 'aegis', 'relay');
