-- Migration 058: Unified decision-outcome view (Phase 14)
--
-- Today scoring reads TWO outcome sources:
--
--   (1) decisions.outcome_success_rate  — written by attributeOutcomeToDecisions()
--       from the /api/outcomes (compile-request) path
--   (2) hermes_outcomes                 — written by POST /api/hermes/outcomes
--       from the per-turn feedback path
--
-- The dual-read is a bug farm: every scoring change has to touch both code
-- paths, and the two signals drift silently when one subsystem is quiet.
-- This view aggregates (2) into the per-decision shape of (1) so callers
-- can migrate to a single source of truth.
--
-- The view is additive and non-breaking. Deprecation of
-- decisions.outcome_success_rate will happen in a follow-up migration
-- after a two-week monitoring window confirms scoring parity.

CREATE OR REPLACE VIEW decision_outcome_stats AS
WITH exploded AS (
  SELECT
    ho.project_id,
    ho.outcome,
    (snippet_elem::text)::uuid AS decision_id
  FROM hermes_outcomes ho,
       LATERAL jsonb_array_elements_text(ho.snippet_ids_json) AS snippet_elem
  WHERE snippet_elem IS NOT NULL
    AND snippet_elem ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)
SELECT
  decision_id,
  project_id,
  COUNT(*) FILTER (WHERE outcome = 'positive') AS positive_count,
  COUNT(*) FILTER (WHERE outcome = 'neutral')  AS neutral_count,
  COUNT(*) FILTER (WHERE outcome = 'negative') AS negative_count,
  COUNT(*) AS total_count,
  -- Laplace-smoothed success rate so decisions with one outcome aren't
  -- pinned to 0.0 or 1.0; matches the semantics of the existing column.
  (COUNT(*) FILTER (WHERE outcome = 'positive')::FLOAT + 1.0)
    / NULLIF(COUNT(*) + 2.0, 0) AS success_rate
FROM exploded
GROUP BY decision_id, project_id;

COMMENT ON VIEW decision_outcome_stats IS
  'Phase 14: aggregates hermes_outcomes per decision. Callers should prefer '
  'this view over decisions.outcome_success_rate. The column is scheduled '
  'for removal after a two-week monitoring window (see migration 058 notes).';

-- Index hermes_outcomes for the view's jsonb_array_elements_text expansion.
-- Without this, a project with N outcomes × M snippets each does a full
-- table scan on every compile. The gin index on jsonb expressions gives us
-- lookups scoped by project + snippet-id match.
CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_snippet_ids
  ON hermes_outcomes USING GIN (snippet_ids_json jsonb_path_ops);

-- Annotate the legacy column so future readers see the transition state.
COMMENT ON COLUMN decisions.outcome_success_rate IS
  'DEPRECATED (Phase 14, migration 058). Prefer decision_outcome_stats.success_rate. '
  'This column remains writable during the monitoring window; removal TBD.';
