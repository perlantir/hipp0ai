-- Migration 062: Re-source decision_outcome_stats from decision_outcomes
--
-- The prior view (058 / 061) aggregated hermes_outcomes and exploded
-- snippet_ids_json with LATERAL jsonb_array_elements_text. That design
-- had three structural problems that kept surfacing as correctness bugs:
--
--   1. Outcomes written through the legacy /api/outcomes path never
--      appeared in the view — that path inserts into decision_outcomes
--      only. Migration 059 backfilled once, but ongoing /api/outcomes
--      writes drifted silently. The view claimed to be canonical and
--      wasn't.
--
--   2. /api/hermes/outcomes wrote BOTH a hermes_outcomes row directly
--      AND (after commit ae48e96) called attributeOutcomeToDecisions,
--      which wrote decision_outcomes rows. Combined with 059's backfill
--      a single reaction ended up represented twice in the view.
--
--   3. Snippet_ids_json is an array of arbitrary strings validated only
--      by UUID-shape regex; the view silently dropped non-UUID entries
--      and had no way to dedupe.
--
-- decision_outcomes is already per-decision keyed, already FK-enforced
-- on decisions.id, and is written by BOTH /api/outcomes and
-- /api/hermes/outcomes (via attributeOutcomeToDecisions with the Phase-5
-- snippet_ids intersection). Sourcing the view from decision_outcomes
-- gives us a single canonical stream with no array explosion, no
-- mirror-writes, no double-count.
--
-- Mapping to the view's historical column names:
--   outcome_type = 'success'                               -> positive_count
--   outcome_type = 'partial'                               -> neutral_count
--   outcome_type IN ('failure','regression','reversed')    -> negative_count
--   outcome_type = 'unknown'                               -> ignored
--
-- Preserves the 90-day window from migration 061 and the raw (non-Laplace)
-- rate that aligns with recomputeOutcomeAggregates.

DROP VIEW IF EXISTS decision_outcome_stats;

CREATE VIEW decision_outcome_stats AS
SELECT
  decision_id,
  project_id,
  SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) AS positive_count,
  SUM(CASE WHEN outcome_type = 'partial' THEN 1 ELSE 0 END) AS neutral_count,
  SUM(CASE WHEN outcome_type IN ('failure', 'regression', 'reversed')
           THEN 1 ELSE 0 END) AS negative_count,
  COUNT(*) FILTER (WHERE outcome_type IN (
    'success', 'partial', 'failure', 'regression', 'reversed'
  )) AS total_count,
  CASE WHEN COUNT(*) FILTER (WHERE outcome_type IN (
         'success', 'partial', 'failure', 'regression', 'reversed'
       )) > 0
       THEN SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END)::FLOAT
         / COUNT(*) FILTER (WHERE outcome_type IN (
             'success', 'partial', 'failure', 'regression', 'reversed'
           ))
       ELSE 0.5
  END AS success_rate
FROM decision_outcomes
WHERE created_at > NOW() - INTERVAL '90 days'
  AND outcome_type IN ('success', 'partial', 'failure', 'regression', 'reversed')
GROUP BY decision_id, project_id;

COMMENT ON VIEW decision_outcome_stats IS
  'Canonical per-decision outcome aggregates. Sourced from decision_outcomes '
  'so a single reaction is counted once regardless of which API path wrote it. '
  '90-day window; raw success rate (small samples dampened by outcomeMultiplier '
  'downstream). Replaces the 058/061 hermes_outcomes-backed definition.';
