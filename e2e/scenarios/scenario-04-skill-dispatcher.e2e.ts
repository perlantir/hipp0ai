/**
 * Scenario 04: Skill dispatcher end-to-end.
 *
 * This scenario is Python-side and lives in the hermulti repo at:
 *   /root/audit/hermulti/tests/integration/test_skill_dispatcher_e2e.py
 *
 * Rationale: the skill dispatcher is Python (agent.skills.dispatcher) and
 * exercises an in-process fake LLM + RecordingProvider, not the hipp0 HTTP
 * API. Running it from vitest would add no coverage.
 *
 * The vitest side is a skipped placeholder so the scenario slot is
 * discoverable.
 */
import { describe, it } from 'vitest';

describe('scenario-04: skill dispatcher', () => {
  it.skip('covered by hermulti/tests/integration/test_skill_dispatcher_e2e.py', () => {
    /* intentional skip */
  });
});
