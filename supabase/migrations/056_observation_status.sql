-- Allow 'observation' as a decision status so the distillery can persist
-- cross-agent observations into the decisions table and have them returned
-- by the compile endpoint alongside regular decisions.
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_status_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_status_check
  CHECK (status IN ('active', 'superseded', 'reverted', 'pending', 'observation'));
