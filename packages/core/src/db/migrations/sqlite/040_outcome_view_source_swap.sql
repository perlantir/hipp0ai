-- Migration 040 (sqlite): Re-source decision_outcome_stats from decision_outcomes
--
-- Mirrors supabase/migrations/062. See that file for full rationale. In
-- short: the prior hermes_outcomes-backed view missed /api/outcomes
-- writes, double-counted reactions that went through both paths, and
-- required array explosion over snippet_ids_json. Sourcing from
-- decision_outcomes (already per-decision, FK-enforced) gives a single
-- canonical stream.

DROP VIEW IF EXISTS decision_outcome_stats;

CREATE VIEW decision_outcome_stats AS
SELECT
  decision_id,
  project_id,
  SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) AS positive_count,
  SUM(CASE WHEN outcome_type = 'partial' THEN 1 ELSE 0 END) AS neutral_count,
  SUM(CASE WHEN outcome_type IN ('failure', 'regression', 'reversed')
           THEN 1 ELSE 0 END) AS negative_count,
  SUM(CASE WHEN outcome_type IN (
    'success', 'partial', 'failure', 'regression', 'reversed'
  ) THEN 1 ELSE 0 END) AS total_count,
  CASE
    WHEN SUM(CASE WHEN outcome_type IN (
           'success', 'partial', 'failure', 'regression', 'reversed'
         ) THEN 1 ELSE 0 END) > 0
    THEN CAST(SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) AS REAL)
       / SUM(CASE WHEN outcome_type IN (
           'success', 'partial', 'failure', 'regression', 'reversed'
         ) THEN 1 ELSE 0 END)
    ELSE 0.5
  END AS success_rate
FROM decision_outcomes
WHERE created_at > datetime('now', '-90 days')
  AND outcome_type IN ('success', 'partial', 'failure', 'regression', 'reversed')
GROUP BY decision_id, project_id;
