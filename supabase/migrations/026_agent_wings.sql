-- Agent Wings: dedicated context spaces with learned cross-agent affinity
-- Each decision belongs to a "wing" (the agent who created it).
-- Agents learn which wings produce decisions they find useful.

-- Add wing column to decisions (defaults to made_by)
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS wing VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_decisions_wing ON decisions(wing);
UPDATE decisions SET wing = made_by WHERE wing IS NULL;

-- Add wing affinity data to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wing_affinity JSONB DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS primary_domain VARCHAR(100);

-- Add wing column to session_steps for wing-aware Super Brain
ALTER TABLE session_steps ADD COLUMN IF NOT EXISTS wing VARCHAR(100);
UPDATE session_steps SET wing = agent_name WHERE wing IS NULL;
