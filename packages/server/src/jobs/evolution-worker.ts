/**
 * Feature 10: Evolution Worker
 *
 * Background job that runs daily at 6 AM UTC.
 * Scans projects for underperforming decisions and generates evolution proposals.
 * Uses setInterval (no cron package) — checks every 5 minutes if it's the right time.
 */
import { getDb } from '@hipp0/core/db/index.js';

let lastRunDate = '';
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runEvolutionScan(): Promise<void> {
  const db = getDb();

  console.warn('[hipp0/evolution] Starting daily evolution scan...');

  // Only projects with 30+ active decisions
  let projects: Array<Record<string, unknown>>;
  try {
    const result = await db.query(
      `SELECT p.id FROM projects p
       JOIN decisions d ON d.project_id = p.id AND d.status = 'active'
       GROUP BY p.id
       HAVING COUNT(*) >= 30`,
      [],
    );
    projects = result.rows as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn('[hipp0/evolution] Failed to query projects:', (err as Error).message);
    return;
  }

  if (projects.length === 0) {
    console.warn('[hipp0/evolution] No projects with 30+ active decisions. Skipping.');
    return;
  }

  const { findEvolutionCandidates, generateEvolutionProposal, simulateProposalImpact } =
    await import('@hipp0/core/intelligence/decision-evolver.js');

  // Expire old proposals first
  try {
    const expired = await db.query(
      `UPDATE decision_evolution_proposals
       SET status = 'expired'
       WHERE status = 'proposed' AND expires_at < NOW()
       RETURNING id`,
      [],
    );
    if (expired.rows.length > 0) {
      console.warn(`[hipp0/evolution] Expired ${expired.rows.length} old proposals`);
    }
  } catch {
    // table may not exist yet
  }

  let totalCreated = 0;

  for (const project of projects) {
    const projectId = project.id as string;
    try {
      const candidates = await findEvolutionCandidates(projectId);
      if (candidates.length === 0) continue;

      console.warn(`[hipp0/evolution] Found ${candidates.length} candidates in project ${projectId.slice(0, 8)}..`);

      for (const candidate of candidates) {
        try {
          const proposal = await generateEvolutionProposal(candidate, projectId);

          // Skip reaffirm — just update validated_at
          if (proposal.change_type === 'reaffirm') {
            await db.query(
              `UPDATE decisions SET validated_at = NOW(), stale = false WHERE id = ?`,
              [candidate.decision_id],
            );
            console.warn(`[hipp0/evolution] Reaffirmed decision ${candidate.decision_id.slice(0, 8)}..`);
            continue;
          }

          const simulation = await simulateProposalImpact(
            candidate.decision_id,
            proposal,
            projectId,
          );

          await db.query(
            `INSERT INTO decision_evolution_proposals
             (project_id, original_decision_id, proposed_title, proposed_description,
              proposed_reasoning, proposed_tags, proposed_affects, trigger_reason,
              trigger_data, predicted_impact, simulation_ran, simulation_results)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectId,
              candidate.decision_id,
              proposal.title,
              proposal.description,
              proposal.reasoning,
              proposal.tags,
              proposal.affects,
              candidate.trigger_reason,
              JSON.stringify(candidate.trigger_data),
              JSON.stringify(proposal.predicted_impact),
              true,
              JSON.stringify(simulation),
            ],
          );

          totalCreated++;

          // Webhook notification (fire-and-forget)
          try {
            const { dispatchWebhooks } = await import('@hipp0/core/webhooks/index.js');
            await dispatchWebhooks(projectId, 'evolution_proposal_created', {
              proposal_decision: candidate.title,
              trigger: candidate.trigger_reason,
              change_type: proposal.change_type,
            });
          } catch {
            console.warn(`[hipp0/evolution] Webhook: evolution_proposal_created for ${candidate.title}`);
          }
        } catch (err) {
          console.warn(
            `[hipp0/evolution] Failed for decision ${candidate.decision_id.slice(0, 8)}:`,
            (err as Error).message,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[hipp0/evolution] Failed for project ${projectId.slice(0, 8)}:`,
        (err as Error).message,
      );
    }
  }

  console.warn(`[hipp0/evolution] Scan complete. Created ${totalCreated} proposals.`);
}

/**
 * Start the evolution worker. Checks every 5 minutes if it's 6 AM UTC.
 * Runs at most once per day.
 */
export function startEvolutionWorker(): void {
  console.warn('[hipp0] Evolution worker: scheduled (daily 6:00 AM UTC)');

  intervalHandle = setInterval(() => {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Run at 6 AM UTC, only once per day
    if (now.getUTCHours() === 6 && now.getUTCMinutes() < 5 && lastRunDate !== todayKey) {
      lastRunDate = todayKey;
      runEvolutionScan().catch((err) => {
        console.warn('[hipp0/evolution] Scan error:', (err as Error).message);
      });
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

/**
 * Stop the evolution worker (for graceful shutdown).
 */
export function stopEvolutionWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
