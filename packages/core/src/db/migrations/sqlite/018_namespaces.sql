-- Add namespace column to decisions for scoped compilation
ALTER TABLE decisions ADD COLUMN namespace TEXT;
CREATE INDEX idx_decisions_namespace ON decisions(namespace) WHERE namespace IS NOT NULL;
