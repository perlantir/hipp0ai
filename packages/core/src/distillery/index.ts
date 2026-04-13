import type {
  ExtractedDecision,
  Contradiction,
  SessionSummary,
  DistilleryResult,
} from '../types.js';

import { extractDecisions, extractAgentItems } from './extractor.js';
import type { AgentUserFact, AgentObservation } from './extractor.js';
import { deduplicateDecisions } from './deduplicator.js';
import { detectContradictions } from './contradiction.js';
import { integrateDecisions } from './graph-integrator.js';
import { createSessionSummary } from './summarizer.js';
import { dispatchWebhooks } from '../webhooks/index.js';
import { withCoreSpan } from '../telemetry.js';

// Re-export everything for consumers
export { extractDecisions, scrubSecrets, INJECTION_GUARD, callLLM, extractAgentItems } from './extractor.js';
export type { AgentUserFact, AgentObservation, AgentExtractionResult } from './extractor.js';
export { deduplicateDecisions } from './deduplicator.js';
export { detectContradictions } from './contradiction.js';
export { integrateDecisions } from './graph-integrator.js';
export { createSessionSummary } from './summarizer.js';

/** Run the full 5-stage distillery pipeline on a raw conversation transcript. */
export async function distill(
  projectId: string,
  conversationText: string,
  agentName: string = 'unknown',
  sessionId?: string,
  source?: string,
): Promise<DistilleryResult> {
  return withCoreSpan('distill_conversation', {
    project_id: projectId,
    agent_name: agentName,
  }, async (__span) => {
  if (!conversationText.trim()) {
    console.warn('[hipp0:distillery] Empty conversation text; pipeline skipped.');
    return {
      decisions_extracted: 0,
      contradictions_found: 0,
      decisions: [],
      session_summary: undefined,
    };
  }

  // Stage 1: Extract (pass projectId for cost tracking + budget enforcement)
  // When source is "hermes", use agent-aware extraction that also pulls
  // user_facts and observations from the conversation.
  let extracted: ExtractedDecision[];
  let userFacts: AgentUserFact[] = [];
  let agentObservations: AgentObservation[] = [];
  try {
    if (source === 'hermes') {
      const agentResult = await extractAgentItems(conversationText, agentName, projectId);
      extracted = agentResult.decisions;
      userFacts = agentResult.user_facts;
      agentObservations = agentResult.observations;
    } else {
      extracted = await extractDecisions(conversationText, projectId);
    }
  } catch (err) {
    console.error('[hipp0:distillery] Stage 1 (extraction) failed:', err);
    extracted = [];
  }

  // Stage 2: Deduplicate
  let deduped: ExtractedDecision[];
  try {
    deduped = await deduplicateDecisions(projectId, extracted);
  } catch (err) {
    console.error('[hipp0:distillery] Stage 2 (deduplication) failed:', err);
    deduped = extracted;
  }

  // Stage 4: Graph Integration (before stage 3 — needs IDs)
  let createdDecisions: import('../types.js').Decision[];
  try {
    createdDecisions = await integrateDecisions(projectId, deduped, sessionId);
  } catch (err) {
    console.error('[hipp0:distillery] Stage 4 (graph integration) failed:', err);
    createdDecisions = [];
  }

  // Stage 3: Contradiction Detection
  let contradictions: Contradiction[];
  try {
    contradictions = await detectContradictions(projectId, createdDecisions);
  } catch (err) {
    console.error('[hipp0:distillery] Stage 3 (contradiction detection) failed:', err);
    contradictions = [];
  }

  // Stage 5: Session Summary
  const topic =
    createdDecisions[0]?.tags[0] ?? createdDecisions[0]?.title ?? 'General Development Session';

  let sessionSummary: SessionSummary | undefined;
  try {
    sessionSummary = await createSessionSummary(
      projectId,
      agentName,
      topic,
      conversationText,
      createdDecisions,
    );
  } catch (err) {
    console.error('[hipp0:distillery] Stage 5 (session summary) failed:', err);
    sessionSummary = undefined;
  }

  // Dispatch webhooks if any decisions were extracted
  if (extracted.length > 0) {
    dispatchWebhooks(projectId, 'distillery_completed', {
      decisions_extracted: extracted.length,
      contradictions_found: contradictions.length,
      agent_name: agentName,
    }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));
  }

  try {
    __span.setAttribute('hipp0.decisions_extracted', extracted.length);
    __span.setAttribute('hipp0.decisions_created', createdDecisions.length);
    __span.setAttribute('hipp0.contradictions_found', contradictions.length);
  } catch { /* ignore */ }

  return {
    decisions_extracted: extracted.length,
    contradictions_found: contradictions.length,
    decisions: createdDecisions,
    session_summary: sessionSummary,
    user_facts: userFacts.length > 0 ? userFacts : undefined,
    observations: agentObservations.length > 0 ? agentObservations : undefined,
  };
  });
}
