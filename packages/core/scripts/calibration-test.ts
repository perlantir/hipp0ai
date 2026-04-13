#!/usr/bin/env tsx
/**
 * Calibration Test — verifies scoring differentiation across agents.
 *
 * Usage: npx tsx packages/core/scripts/calibration-test.ts
 */

import { initDb, getDb, closeDb } from '../src/db/index.js';
import { compileContext } from '../src/context-compiler/index.js';

const TASK = 'Build the Bouts leaderboard API with real-time ELO updates';
const AGENTS = ['maks', 'makspm', 'counsel', 'pixel', 'gauntlet', 'forge', 'chain', 'scout', 'launch'];

async function main() {
  console.log('[calibration] Initializing...');
  await initDb();
  const db = getDb();

  const projResult = await db.query('SELECT id, name FROM projects ORDER BY created_at LIMIT 1', []);
  if (projResult.rows.length === 0) {
    console.error('[calibration] No projects found.');
    process.exit(1);
  }
  const project = projResult.rows[0] as Record<string, unknown>;
  const projectId = project.id as string;
  console.log(`Task: "${TASK}"\n`);

  const agentResults: Map<string, { decisions: Array<{ id: string; title: string; combined_score: number }>; role: string }> = new Map();

  for (const agentName of AGENTS) {
    const agentResult = await db.query(
      "SELECT id, role FROM agents WHERE project_id = ? AND name = ? AND role != 'inactive'",
      [projectId, agentName],
    );
    if (agentResult.rows.length === 0) {
      console.log(`Agent: ${agentName} — NOT FOUND (skipping)\n`);
      continue;
    }
    const role = (agentResult.rows[0] as Record<string, unknown>).role as string;

    try {
      const result = await compileContext({
        agent_name: agentName,
        project_id: projectId,
        task_description: TASK,
        max_tokens: 200000,
      });

      const decisions = result.decisions;
      const top5 = decisions.slice(0, 5);
      const scores = decisions.map((d) => d.combined_score);
      const minScore = scores.length > 0 ? Math.min(...scores) : 0;
      const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

      agentResults.set(agentName, { decisions: decisions.map(d => ({ id: d.id, title: d.title, combined_score: d.combined_score })), role });

      console.log(`Agent: ${agentName} (role: ${role})`);
      console.log(`  Top 5: ${top5.map((d) => `[${d.combined_score.toFixed(2)}] ${d.title.slice(0, 40)}`).join(' | ')}`);
      console.log(`  Total qualified: ${decisions.length} | Score range: ${minScore.toFixed(2)} - ${maxScore.toFixed(2)}`);
      console.log('');
    } catch (err) {
      console.error(`Agent: ${agentName} — ERROR: ${(err as Error).message}\n`);
    }
  }

  // Differentiation check
  console.log('Differentiation check:');
  const agentNames = Array.from(agentResults.keys());
  for (let i = 0; i < agentNames.length; i++) {
    for (let j = i + 1; j < agentNames.length; j++) {
      const a = agentResults.get(agentNames[i])!;
      const b = agentResults.get(agentNames[j])!;
      const topA = new Set(a.decisions.slice(0, 10).map((d) => d.id));
      const topB = new Set(b.decisions.slice(0, 10).map((d) => d.id));
      const overlap = [...topA].filter((id) => topB.has(id)).length;
      const uniquePct = Math.round((1 - overlap / Math.max(topA.size, topB.size, 1)) * 100);
      const emoji = uniquePct >= 70 ? '✅' : uniquePct >= 50 ? '⚠️' : '❌';
      console.log(`  ${agentNames[i]} vs ${agentNames[j]} overlap in top-10: ${overlap}/${Math.min(topA.size, topB.size)} (${uniquePct}% unique) ${emoji}`);
    }
  }

  await closeDb();
}

main().catch((err) => {
  console.error('[calibration] Fatal error:', err);
  process.exit(1);
});
