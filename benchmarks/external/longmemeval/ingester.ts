/**
 * LongMemEval ingester.
 *
 * Takes a `LongMemEvalCase`, spins up a fresh Hipp0 project, creates the
 * canonical agents (user, assistant, architect), then walks each session
 * and posts its turns to `/api/capture`. For speed the ingester defaults
 * to "direct decision recording" mode which bypasses the distillery and
 * writes each turn directly as a Hipp0 decision — this keeps the harness
 * deterministic and keeps a single benchmark run under a few seconds per
 * case. Pass `useDistillery: true` to exercise the full capture + extract
 * pipeline (slower, closer to production behavior).
 */

import { Hipp0Client } from '@hipp0/sdk';
import type { LongMemEvalCase, IngestionResult } from './types.js';

export interface IngesterOptions {
  /** If true, use /api/capture + distillery. Default: false (direct record). */
  useDistillery?: boolean;
  /** Poll interval when waiting for distillery extraction. */
  pollIntervalMs?: number;
  /** Maximum time we'll wait for capture to finish. */
  captureTimeoutMs?: number;
  /** Optional prefix for the generated project name. */
  projectNamePrefix?: string;
}

const DEFAULT_OPTIONS: Required<IngesterOptions> = {
  useDistillery: false,
  pollIntervalMs: 500,
  captureTimeoutMs: 60_000,
  projectNamePrefix: 'longmemeval',
};

const AGENT_SPECS: Array<{ name: string; role: string }> = [
  { name: 'user', role: 'Human user in a long-running conversation' },
  { name: 'assistant', role: 'AI chat assistant being evaluated' },
  { name: 'architect', role: 'Memory architect coordinating retrieval' },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

/** Turn a LongMemEval session into a single plain-text transcript. */
function renderSessionTranscript(
  session: { role: string; content: string }[],
  sessionDate?: string,
): string {
  const header = sessionDate ? `Session recorded on ${sessionDate}\n\n` : '';
  const lines = session.map((turn) => {
    const speaker = turn.role === 'assistant' ? 'Assistant' : turn.role === 'system' ? 'System' : 'User';
    return `${speaker}: ${turn.content}`;
  });
  return header + lines.join('\n');
}

export class LongMemEvalIngester {
  private readonly client: Hipp0Client;
  private readonly options: Required<IngesterOptions>;

  constructor(client: Hipp0Client, options: IngesterOptions = {}) {
    this.client = client;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async ingestCase(testCase: LongMemEvalCase): Promise<IngestionResult> {
    const started = Date.now();

    const projectName = `${this.options.projectNamePrefix}_${sanitizeId(testCase.question_id)}`;
    const project = await this.client.createProject({
      name: projectName,
      description: `LongMemEval case ${testCase.question_id} (${testCase.question_type})`,
      metadata: {
        benchmark: 'longmemeval',
        question_id: testCase.question_id,
        question_type: testCase.question_type,
      },
    });

    // Create the three canonical agents.
    for (const spec of AGENT_SPECS) {
      try {
        await this.client.createAgent(project.id, {
          name: spec.name,
          role: spec.role,
        });
      } catch (err) {
        // Agents may already exist if the project is reused — ignore conflicts.
        if ((err as Error).message && !(err as Error).message.includes('already')) {
          throw err;
        }
      }
    }

    let totalTurns = 0;
    let decisionsCreated = 0;

    for (let sessionIdx = 0; sessionIdx < testCase.haystack_sessions.length; sessionIdx++) {
      const session = testCase.haystack_sessions[sessionIdx]!;
      const sessionId = testCase.haystack_session_ids[sessionIdx] ?? `session_${sessionIdx}`;
      const sessionDate = testCase.haystack_dates[sessionIdx] ?? '';

      // Create a Hipp0 TaskSession so each haystack session has a corresponding
      // session boundary we can reference from captured turns.
      let hipp0SessionId: string | undefined;
      try {
        const started = await this.client.startSession({
          project_id: project.id,
          title: `LME session ${sessionIdx + 1} (${sessionId})`,
          description: sessionDate || undefined,
        });
        hipp0SessionId = started.session_id;
      } catch {
        hipp0SessionId = undefined;
      }

      if (this.options.useDistillery) {
        decisionsCreated += await this.ingestSessionViaCapture(
          project.id,
          session,
          sessionId,
          sessionDate,
          hipp0SessionId,
        );
      } else {
        decisionsCreated += await this.ingestSessionViaDirectRecord(
          project.id,
          session,
          sessionId,
          sessionDate,
        );
      }
      totalTurns += session.length;

      // Close out the session so later queries see it as completed.
      if (hipp0SessionId) {
        try {
          await this.client.completeSession(hipp0SessionId);
        } catch {
          /* non-fatal */
        }
      }
    }

    return {
      project_id: project.id,
      project_name: projectName,
      session_count: testCase.haystack_sessions.length,
      turn_count: totalTurns,
      decisions_created: decisionsCreated,
      ingestion_time_ms: Date.now() - started,
    };
  }

  /**
   * Slow path: post a rendered transcript to /api/capture and wait for the
   * distillery pipeline to finish extracting decisions. Exercises the full
   * stack — use this for "real" benchmark runs.
   */
  private async ingestSessionViaCapture(
    projectId: string,
    session: { role: string; content: string }[],
    sessionId: string,
    sessionDate: string,
    hipp0SessionId: string | undefined,
  ): Promise<number> {
    const transcript = renderSessionTranscript(session, sessionDate);
    const capture = await this.client.autoCapture({
      agent_name: 'assistant',
      project_id: projectId,
      conversation: transcript,
      session_id: hipp0SessionId ?? sessionId,
      source: 'longmemeval',
    });

    const deadline = Date.now() + this.options.captureTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const status = await this.client.getCaptureStatus(capture.capture_id);
        if (status.status === 'completed' || status.status === 'failed') {
          return status.extracted_decision_count ?? 0;
        }
      } catch {
        // tolerate transient errors and keep polling
      }
      await sleep(this.options.pollIntervalMs);
    }

    // Timed out — return 0 so the runner records a soft failure rather than
    // crashing the entire run.
    return 0;
  }

  /**
   * Fast path: write each turn as a Hipp0 decision directly. This is the
   * default because it makes benchmark runs deterministic and keeps the
   * harness usable without an OpenAI key (the distillery path invokes an LLM
   * for extraction). Each turn becomes one decision tagged with the session
   * id so retrieval can still use 5-signal scoring.
   */
  private async ingestSessionViaDirectRecord(
    projectId: string,
    session: { role: string; content: string }[],
    sessionId: string,
    sessionDate: string,
  ): Promise<number> {
    let created = 0;
    for (let turnIdx = 0; turnIdx < session.length; turnIdx++) {
      const turn = session[turnIdx]!;
      const madeBy = turn.role === 'assistant' ? 'assistant' : turn.role === 'system' ? 'architect' : 'user';
      const title = turn.content.slice(0, 80).replace(/\s+/g, ' ').trim() || `Turn ${turnIdx + 1}`;

      try {
        await this.client.createDecision(projectId, {
          title,
          description: turn.content,
          reasoning: `Captured from LongMemEval session ${sessionId} turn ${turnIdx + 1}${sessionDate ? ` (${sessionDate})` : ''}.`,
          made_by: madeBy,
          source: 'imported',
          confidence: 'medium',
          tags: [
            'longmemeval',
            `session:${sessionId}`,
            `role:${turn.role}`,
            sessionDate ? `date:${sessionDate.slice(0, 10)}` : 'date:unknown',
          ],
          metadata: {
            longmemeval_session_id: sessionId,
            longmemeval_session_date: sessionDate,
            longmemeval_turn_index: turnIdx,
            longmemeval_role: turn.role,
          },
        });
        created++;
      } catch (err) {
        // Individual turn failures shouldn't kill ingestion — just log and continue.
        // eslint-disable-next-line no-console
        console.warn(
          `[longmemeval] failed to ingest turn ${turnIdx} of session ${sessionId}: ${(err as Error).message}`,
        );
      }
    }
    return created;
  }
}
