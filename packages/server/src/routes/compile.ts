/**
 * Compile Route — delegates to core compileContext() for all scoring,
 * sorting, and formatting. The route only handles HTTP concerns:
 * request parsing, audit logging, compile history recording, and
 * the debug mode overlay.
 */

import crypto from 'node:crypto';
import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { compileContext } from '@hipp0/core/context-compiler/index.js';
import { withSpan, getMetrics, recordCounter, recordHistogram } from '../telemetry.js';
import { condenseCompileResponse, computeCompressionMetrics, encodeH0C, encodeH0CPatterns, encodeH0CUltra, estimateTokens } from '@hipp0/core';
import type { CompileRequest } from '@hipp0/core/types.js';
import { requireUUID, requireString, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { broadcast } from '../websocket.js';
import { safeEmit } from '../events/event-stream.js';
import { cache, compileKey, CACHE_TTL } from '../cache/redis.js';
import { getSessionContext } from '@hipp0/core/memory/session-manager.js';
import { generateRoleSignal, computeRecommendedAction } from '@hipp0/core/intelligence/role-signals.js';
import type { ActionSignal } from '@hipp0/core/intelligence/role-signals.js';
import { computeAgentSkillProfile } from '@hipp0/core/intelligence/skill-profiler.js';
import { generateContrastiveExplanation, generateTopContrastPairs } from '@hipp0/core/intelligence/contrastive-explainer.js';
import type { ContrastiveExplanation } from '@hipp0/core/intelligence/contrastive-explainer.js';
import { rewriteExplanationsBatch } from '@hipp0/core/intelligence/llm-explainer.js';
import {
  getRelevantSharedPatterns,
  isAutoShareEnabled,
  toSuggestedPattern,
} from '@hipp0/core/intelligence/cross-project-patterns.js';
import type { SharedPatternRecord } from '@hipp0/core/intelligence/cross-project-patterns.js';
import { getInsights } from '@hipp0/core/intelligence/knowledge-pipeline.js';
import type { KnowledgeInsight } from '@hipp0/core/intelligence/knowledge-pipeline.js';

export function registerCompileRoutes(app: Hono): void {
  app.post('/api/compile', async (c) => {
    const __compileStart = Date.now();
    const __metrics = getMetrics();
    let __compileFormat: string = 'json';
    let __compileAgent: string | undefined;
    let __compileProject: string | undefined;
    let __compileDecisionsIncluded = 0;
    let __compileSuccess = true;

    return withSpan('compile_context', undefined, async (__span) => {
      try {
    const db = getDb();
    const body = await c.req.json<{
      agent_name?: unknown;
      project_id?: unknown;
      task_description?: unknown;
      task?: unknown;
      max_tokens?: number;
      include_superseded?: boolean;
      session_lookback_days?: number;
      task_session_id?: unknown;
      include_role_signal?: boolean;
      debug?: boolean;
      namespace?: unknown;
    }>();

    const agent_name = requireString(body.agent_name, 'agent_name', 200);
    const project_id = requireUUID(body.project_id, 'project_id');
    __compileAgent = agent_name;
    __compileProject = project_id;
    try {
      __span.setAttribute('hipp0.agent_name', agent_name);
      __span.setAttribute('hipp0.project_id', project_id);
    } catch { /* ignore */ }
    await requireProjectAccess(c, project_id);
    // Accept both `task` and `task_description` — prefer task_description when both provided
    const rawTaskDescription = body.task_description ?? body.task;
    const task_description = requireString(rawTaskDescription, 'task_description', 100000);

      // Format parameter: h0c (default) | json/full | condensed | both | ultra | markdown
    // ?expanded=true is an alias for ?format=json
    // Accept header: application/json → json, otherwise h0c
    const acceptsJson = c.req.header('Accept')?.includes('application/json');
    const expandedParam = c.req.query('expanded');
    const rawFormat = expandedParam === 'true' ? 'json' : (c.req.query('format') ?? (acceptsJson ? 'json' : 'h0c'));
    const format = rawFormat as 'full' | 'json' | 'condensed' | 'both' | 'h0c' | 'ultra' | 'markdown';
    __compileFormat = format;
    try { __span.setAttribute('hipp0.format', format); } catch { /* ignore */ }
      // Depth parameter: default | full (loads L2 background decisions)
    const depthParam = (c.req.query('depth') ?? 'default') as 'default' | 'full';
      // Threshold parameter: override the default minimum relevance score (0.5)
    const thresholdParam = c.req.query('threshold');
    const minScore = thresholdParam ? Math.max(0, Math.min(1, parseFloat(thresholdParam))) : undefined;

      // Pattern recommendations: can be suppressed per-request
    const includePatternsParam = c.req.query('include_patterns');
    const includePatterns = includePatternsParam !== 'false';

      // Contrastive explanations: enabled via ?explain=true or debug mode
    const explainParam = c.req.query('explain');
    const includeExplanations = explainParam === 'true' || body.debug === true;
      // Pretty (LLM-rewritten) explanations: opt-in via ?pretty=true on top of ?explain=true.
      // LLM is NEVER called in the hot path unless this query param is set.
    const prettyParam = c.req.query('pretty');
    const includePrettyExplanations = includeExplanations && prettyParam === 'true';

      // Check prefetch cache first (session-aware)
    if (body.task_session_id && body.debug !== true) {
      try {
        const sessionId = requireUUID(body.task_session_id, 'task_session_id');
        const prefetchKey = `prefetch:${sessionId}:${agent_name}`;
        const prefetchHit = await cache.get(prefetchKey);
        if (prefetchHit) {
          const prefetched = JSON.parse(prefetchHit);
          // Clear the prefetch entry after use
          await cache.del(prefetchKey);
          return c.json({ ...prefetched, cache_hit: true, prefetch_hit: true });
        }
      } catch {
        // Invalid prefetch entry or bad session_id, proceed normally
      }
    }

      // Check cache first
    const taskHash = crypto.createHash('sha256').update(task_description).digest('hex');
    const cacheHit = await cache.get(compileKey(project_id, agent_name, taskHash));
    if (cacheHit && body.debug !== true) {
      try {
        const cached = JSON.parse(cacheHit);
        return c.json({ ...cached, cache_hit: true });
      } catch {
        // Invalid cache entry, proceed with fresh compile
      }
    }

      // Delegate to core compileContext()
    // This uses the full 5-signal scoring pipeline: freshness weighting,
    // confidence decay, graph expansion, score blending, context caching,
    // and markdown + JSON formatting.
    // Namespace filter: from body or query parameter
    const namespaceParam = typeof body.namespace === 'string' ? body.namespace : (c.req.query('namespace') ?? undefined);

    const request: CompileRequest = {
      agent_name,
      project_id,
      task_description,
      max_tokens: body.max_tokens,
      include_superseded: body.include_superseded,
      session_lookback_days: body.session_lookback_days,
      depth: depthParam,
      namespace: namespaceParam,
      min_score: minScore,
      include_patterns: includePatterns,
    };

    const result = await compileContext(request);

    // Fetch user_facts for the whole project. user_facts are about the
    // *user* (preferences, habits, vibes, identity) — they apply across
    // every agent in the project, regardless of which agent originally
    // captured them. Filtering by agent_name would break the core
    // cross-agent memory thesis (e.g. Pixel learns the user's color
    // palette, Chain should be able to recall it).
    let userFacts: Array<{ key: string; value: string; confidence: number }> = [];
    try {
      const ufResult = await db.query(
        `SELECT fact_key, fact_value, confidence FROM user_facts
         WHERE project_id = ? AND is_active = true
         ORDER BY updated_at DESC LIMIT 20`,
        [project_id],
      );
      userFacts = ufResult.rows.map((r: any) => ({
        key: r.fact_key as string,
        value: r.fact_value as string,
        confidence: (r.confidence as number) ?? 1.0,
      }));
      if (userFacts.length > 0) {
        await db.query(
          `UPDATE user_facts SET last_referenced_at = NOW()
           WHERE project_id = ? AND is_active = true`,
          [project_id],
        ).catch(() => {});
      }
    } catch (err) {
      console.warn('[hipp0/compile] user_facts query failed:', (err as Error).message);
    }

    __compileDecisionsIncluded = result.decisions_included ?? 0;
    try {
      __span.setAttribute('hipp0.decisions_included', __compileDecisionsIncluded);
      __span.setAttribute('hipp0.decisions_considered', result.decisions_considered ?? 0);
    } catch { /* ignore */ }

      // Cross-Project Pattern Sharing: when the project has opted in, include
      // the top community patterns so agents can benefit from network effects.
      // Opt-in signal = projects.share_anonymous_patterns OR HIPP0_SHARE_PATTERNS=true.
      let communityPatterns: Array<Record<string, unknown>> | undefined;
      if (includePatterns) {
        try {
          let optedIn = isAutoShareEnabled();
          if (!optedIn) {
            const projRow = await db.query<Record<string, unknown>>(
              'SELECT share_anonymous_patterns FROM projects WHERE id = ? LIMIT 1',
              [project_id],
            );
            if (projRow.rows.length > 0) {
              const raw = (projRow.rows[0] as Record<string, unknown>).share_anonymous_patterns;
              optedIn = raw === true || raw === 1 || raw === '1' || raw === 't';
            }
          }

          if (optedIn) {
            const taskTags = [...new Set((result.decisions ?? []).flatMap((d: any) => d.tags ?? []))] as string[];
            const relevant: SharedPatternRecord[] = await getRelevantSharedPatterns(
              project_id,
              task_description,
              taskTags,
            );
            // Only surface patterns with meaningful social proof or success.
            const filtered = relevant.filter(
              (p) => p.adoption_count >= 2 || p.success_rate >= 0.6,
            );
            if (filtered.length > 0) {
              communityPatterns = filtered.slice(0, 3).map((p) => ({
                ...toSuggestedPattern(p),
                domain: p.domain,
                tags: p.tags,
                adoption_count: p.adoption_count,
                success_rate: Math.round(p.success_rate * 100) / 100,
              }));
            }
          }
        } catch (err) {
          console.warn(
            '[hipp0:compile] Community pattern lookup failed:',
            (err as Error).message,
          );
        }
      }

      // Server-only concerns: audit + history
    const compileRequestId = crypto.randomUUID();
    const contextHash = crypto.createHash('sha256')
      .update(result.formatted_markdown)
      .digest('hex');

    // Privacy: store hash by default, raw text only if HIPP0_STORE_RAW_TASKS=true
    const storeRawTasks = process.env.HIPP0_STORE_RAW_TASKS === 'true';
    const taskForStorage = storeRawTasks
      ? task_description
      : crypto.createHash('sha256').update(task_description).digest('hex');

    // Audit log (always uses hash — taskHash computed above for cache key)
    logAudit('compile_request', project_id, {
      agent_name,
      task_description_sha256: taskHash,
      decisions_included: result.decisions_included,
      decisions_considered: result.decisions_considered,
      compilation_time_ms: result.compilation_time_ms,
    });

    // Record compile history
    const agentResult = await db.query(
      'SELECT id FROM agents WHERE project_id = ? AND name = ? LIMIT 1',
      [project_id, agent_name],
    );
    const agentId = agentResult.rows.length > 0
      ? (agentResult.rows[0] as Record<string, unknown>).id as string
      : 'unknown';

    try {
      await db.query(
        `INSERT INTO compile_history
         (id, project_id, agent_id, agent_name, task_description,
          decision_ids, decision_scores, total_decisions,
          token_budget_used, context_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          compileRequestId,
          project_id,
          agentId,
          agent_name,
          taskForStorage,
          db.arrayParam(result.decisions.map((d) => d.id)),
          JSON.stringify(result.decisions.map((d) => ({
            id: d.id,
            title: d.title,
            combined_score: d.combined_score,
          }))),
          result.decisions_included,
          result.token_count,
          contextHash,
        ],
      );
    } catch (err) {
      console.warn('[hipp0:compile] History recording failed:', (err as Error).message);
    }

      // Debug info (optional)
    let debugInfo: Record<string, unknown> | undefined;
    if (body.debug === true) {
      let skillProfile: Record<string, unknown> | undefined;
      try {
        skillProfile = await computeAgentSkillProfile(project_id, agent_name) as unknown as Record<string, unknown>;
      } catch (err) {
        console.warn('[hipp0:compile] Skill profile failed:', (err as Error).message);
      }

      debugInfo = {
        scoring_pipeline: 'core/context-compiler compileContext()',
        signals: ['direct_affect', 'tag_matching', 'role_relevance', 'semantic_similarity', 'status_penalty', 'trust_multiplier', 'outcome_multiplier'],
        task_hash: taskHash,
        raw_tasks_stored: storeRawTasks,
        decisions: result.decisions.map((d: any) => ({
          id: d.id,
          title: d.title,
          combined_score: d.combined_score,
          trust_score: d.trust_score ?? null,
          trust_multiplier: (d.scoring_breakdown as Record<string, unknown>)?.trust_multiplier ?? null,
          outcome_multiplier: (d.scoring_breakdown as Record<string, unknown>)?.outcome_multiplier ?? null,
          scoring_breakdown: d.scoring_breakdown,
        })),
        ...(skillProfile ? { skill_profile: skillProfile } : {}),
      };
    }

      // Contrastive explanations (optional)
    let contrastiveExplanations:
      | Array<ContrastiveExplanation & { deterministic?: string; pretty?: string }>
      | undefined;
    if (includeExplanations && result.decisions.length >= 2) {
      // Decisions are already sorted by combined_score descending
      const sorted = result.decisions;
      const explanations: ContrastiveExplanation[] = [];

      // Why #1 beat the lowest-ranked included decision
      explanations.push(
        generateContrastiveExplanation(sorted[0], sorted[sorted.length - 1]),
      );

      // If there are enough decisions, also explain why the last included
      // beat the next-to-last (boundary insight)
      if (sorted.length >= 3) {
        explanations.push(
          generateContrastiveExplanation(sorted[sorted.length - 2], sorted[sorted.length - 1]),
        );
      }

      // When ?pretty=true is opted in, rewrite the deterministic explanations
      // through the LLM layer. Errors fall back to the deterministic text.
      let prettyTexts: string[] | null = null;
      if (includePrettyExplanations) {
        try {
          prettyTexts = await rewriteExplanationsBatch(
            explanations.map((e) => ({
              text: e.explanation,
              context: {
                decisionA: { title: e.higher.title },
                decisionB: { title: e.lower.title },
                agentName: agent_name,
              },
            })),
            { projectId: project_id },
          );
        } catch (err) {
          console.warn(
            '[hipp0:compile] Pretty explanation rewrite failed:',
            (err as Error).message,
          );
          prettyTexts = null;
        }
      }

      contrastiveExplanations = explanations.map((e, idx) => {
        const pretty = prettyTexts?.[idx];
        // Preserve the deterministic text under a dedicated key so clients
        // can show both side-by-side when ?pretty=true was requested.
        const enriched: ContrastiveExplanation & { deterministic?: string; pretty?: string } = {
          ...e,
          deterministic: e.explanation,
        };
        if (pretty && pretty !== e.explanation) {
          enriched.pretty = pretty;
          enriched.explanation = pretty;
        }
        return enriched;
      });
    }

      // Broadcast compile completion
    broadcast('compile_completed', {
      compile_request_id: compileRequestId,
      project_id,
      agent_name,
      decisions_included: result.decisions_included,
    });

    safeEmit('compile.completed', project_id, {
      compile_request_id: compileRequestId,
      agent_name,
      decisions_included: result.decisions_included,
      total_tokens: (result as unknown as Record<string, unknown>).total_tokens,
      format,
    });

      // Governance: policy overlay
    let policyNotices: Array<Record<string, unknown>> = [];
    let policySummary: Record<string, unknown> | undefined;
    let policyMarkdown = '';

    try {
      const activePolicies = await db.query(
        `SELECT dp.*, d.title AS decision_title
         FROM decision_policies dp
         JOIN decisions d ON dp.decision_id = d.id
         WHERE dp.project_id = ? AND dp.active = ?
           AND (dp.expires_at IS NULL OR dp.expires_at > ?)`,
        [project_id, true, new Date().toISOString()],
      );

      if (activePolicies.rows.length > 0) {
        const blockPolicies: Array<{ title: string; approved_by: string }> = [];
        const warnPolicies: Array<{ title: string; approved_by: string }> = [];
        const advisoryPolicies: Array<{ title: string }> = [];
        const compiledIds = (result.decisions ?? []).map((d: { id?: string }) => d.id);

        for (const row of activePolicies.rows) {
          const p = row as Record<string, unknown>;
          const enforcement = p.enforcement as string;
          const title = p.decision_title as string;
          const approvedBy = p.approved_by as string;

          // Check applies_to scoping
          let appliesTo: string[] = [];
          if (Array.isArray(p.applies_to)) appliesTo = p.applies_to as string[];
          else if (typeof p.applies_to === 'string') {
            try { appliesTo = JSON.parse(p.applies_to as string); } catch { appliesTo = []; }
          }
          if (appliesTo.length > 0 && !appliesTo.includes(agent_name)) continue;

          const msg = enforcement === 'block'
            ? `POLICY REQUIREMENT: You MUST comply with "${title}". This is an approved, enforced policy.`
            : enforcement === 'warn'
              ? `POLICY ADVISORY: "${title}" is an approved decision. Consider compliance carefully.`
              : `Policy note: "${title}" is an approved decision.`;

          policyNotices.push({
            decision_id: p.decision_id,
            decision_title: title,
            enforcement,
            category: p.category,
            approved_by: approvedBy,
            message: msg,
          });

          if (enforcement === 'block') blockPolicies.push({ title, approved_by: approvedBy });
          else if (enforcement === 'warn') warnPolicies.push({ title, approved_by: approvedBy });
          else advisoryPolicies.push({ title });
        }

        policySummary = {
          block_policies: blockPolicies,
          warn_policies: warnPolicies,
          advisory_policies: advisoryPolicies,
          total_enforced: blockPolicies.length + warnPolicies.length,
        };

        // Build markdown section for enforced policies
        const enforced = policyNotices.filter((n) => n.enforcement !== 'advisory');
        if (enforced.length > 0) {
          const lines = enforced.map((n) => `- ${n.message}`).join('\n');
          policyMarkdown = `## Active Policies (${enforced.length} enforced)\n${lines}\n\n---\n\n`;
        }
      }
    } catch (err) {
      console.warn('[hipp0:compile] Policy overlay failed:', (err as Error).message);
    }

      // Session Memory: prepend session context when task_session_id is provided
    let sessionMarkdown = '';
    let sessionMeta: Record<string, unknown> | undefined;
    if (body.task_session_id) {
      try {
        const taskSessionId = requireUUID(body.task_session_id, 'task_session_id');
        const sessionCtx = await getSessionContext(taskSessionId, agent_name, task_description, project_id);
        sessionMarkdown = sessionCtx.formatted_session_context + '\n\n---\n\n';
        sessionMeta = {
          session_id: sessionCtx.session.id,
          session_title: sessionCtx.session.title,
          session_status: sessionCtx.session.status,
          previous_steps: sessionCtx.previous_steps.length,
          agents_involved: sessionCtx.session.agents_involved,
        };
      } catch (err) {
        console.warn('[hipp0:compile] Session context failed:', (err as Error).message);
      }
    }

      // Checkpoint Restoration: include saved checkpoints in session context
    let checkpointMarkdown = '';
    if (body.task_session_id) {
      try {
        const taskSessionId = requireUUID(body.task_session_id, 'task_session_id');
        const checkpointResult = await db.query(
          `SELECT checkpoint_text, important_decision_ids, created_at
           FROM session_checkpoints
           WHERE session_id = ? AND agent_name = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [taskSessionId, agent_name],
        );
        if (checkpointResult.rows.length > 0) {
          const cp = checkpointResult.rows[0] as Record<string, unknown>;
          const cpText = cp.checkpoint_text as string;
          const cpDate = cp.created_at instanceof Date ? cp.created_at.toISOString() : String(cp.created_at);
          checkpointMarkdown = `## [RESTORED FROM CHECKPOINT]\n_Saved at ${cpDate}_\n\n${cpText}\n\n---\n\n`;
        }
      } catch (err) {
        console.warn('[hipp0:compile] Checkpoint restoration failed:', (err as Error).message);
      }
    }

      // Role Signal: generate when session or explicitly requested
    let roleSignal: Record<string, unknown> | undefined;
    let abstentionMarkdown = '';
    if (body.task_session_id || body.include_role_signal) {
      try {
        const sessionIdForSignal = body.task_session_id
          ? requireUUID(body.task_session_id, 'task_session_id')
          : undefined;
        const signal = await generateRoleSignal(project_id, agent_name, task_description, sessionIdForSignal);
        roleSignal = {
          should_participate: signal.should_participate,
          abstain_probability: signal.abstain_probability,
          role_suggestion: signal.role_suggestion,
          reason: signal.reason,
          relevance_score: signal.relevance_score,
          rank: signal.rank_among_agents,
          total_agents: signal.total_agents,
        };
        if (!signal.should_participate) {
          abstentionMarkdown = `> **Abstention Notice:** ${agent_name} has low relevance for this task (score: ${signal.relevance_score}, rank: ${signal.rank_among_agents}/${signal.total_agents}). Consider delegating to a more relevant agent.\n\n`;
          // Apply multiplicative score penalty (0.2x) to every compiled
          // decision so downstream consumers that rank by combined_score
          // see the abstention signal, not just the markdown note.
          const ROLE_ABSTAIN_PENALTY = 0.2;
          for (const d of result.decisions) {
            const prev = (d as { combined_score?: number }).combined_score ?? 0;
            (d as { combined_score: number }).combined_score = prev * ROLE_ABSTAIN_PENALTY;
            const breakdown = (d as unknown as { scoring_breakdown?: Record<string, unknown> }).scoring_breakdown;
            if (breakdown && typeof breakdown === 'object') {
              (breakdown as Record<string, unknown>).role_abstain_penalty = ROLE_ABSTAIN_PENALTY;
              (breakdown as Record<string, unknown>).combined = prev * ROLE_ABSTAIN_PENALTY;
            }
          }
        }
      } catch (err) {
        console.warn('[hipp0:compile] Role signal generation failed:', (err as Error).message);
      }
    }

    // Team Insights (Tier 3): fetch distilled team knowledge and filter to
    // those matching the compiled decisions' domains/tags.
    let teamInsights: KnowledgeInsight[] = [];
    try {
      const allInsights = await getInsights(project_id, {
        status: 'active',
        min_confidence: 0.5,
        limit: 50,
      });

      if (allInsights.length > 0) {
        // Build the set of domains and tags present in the compiled decisions
        const compiledDomains = new Set<string>();
        const compiledTags = new Set<string>();
        for (const d of result.decisions) {
          const domain = (d as { domain?: string | null }).domain;
          if (domain) compiledDomains.add(domain);
          const tags = (d as { tags?: string[] }).tags ?? [];
          for (const t of tags) compiledTags.add(t);
        }

        // Filter insights that match the compiled context:
        //   - procedures/policies/anti_patterns with no domain are always relevant
        //   - insights whose domain matches one compiled domain are relevant
        //   - insights whose tags intersect the compiled tags are relevant
        teamInsights = allInsights
          .filter((ins: KnowledgeInsight) => {
            if (ins.domain && compiledDomains.has(ins.domain)) return true;
            if (ins.tags.some((t: string) => compiledTags.has(t))) return true;
            // Procedures (which rarely have a domain) are always relevant
            if (ins.insight_type === 'procedure' && !ins.domain) return true;
            return false;
          })
          .slice(0, 10);
      }
    } catch (err) {
      console.warn('[hipp0:compile] Team insights fetch failed:', (err as Error).message);
    }

    // Build insights markdown section
    let insightsMarkdown = '';
    if (teamInsights.length > 0) {
      const lines = teamInsights.map((ins: KnowledgeInsight) => {
        const pct = Math.round(ins.confidence * 100);
        const label = ins.insight_type.replace('_', '-');
        return `- **[${label}]** ${ins.title} _(${pct}% confidence)_\n  ${ins.description}`;
      });
      insightsMarkdown = `## Team Insights (${teamInsights.length})\n${lines.join('\n')}\n\n---\n\n`;
    }

    // Render user_facts as a markdown section so the agent actually sees
    // them. They were already in the JSON payload but absent from the
    // formatted_markdown the LLM reads as its prompt — which meant the
    // cross-agent preferences/habits/vibes never reached the model.
    let userFactsMarkdown = '';
    if (userFacts.length > 0) {
      const lines = userFacts.map(f => `- **${f.key}**: ${f.value}`);
      userFactsMarkdown = `## 👤 User Facts (${userFacts.length})\n${lines.join('\n')}\n\n---\n\n`;
    }

    // Prepend policy markdown to formatted output
    const formattedMarkdown = abstentionMarkdown + checkpointMarkdown + sessionMarkdown
      + (policyMarkdown ? policyMarkdown : '')
      + userFactsMarkdown
      + insightsMarkdown
      + (result.formatted_markdown ?? '');

      // Hint for 0 results
    let hint: string | undefined;
    if (result.decisions_included === 0) {
      // Check if project has any decisions at all
      let totalProjectDecisions = 0;
      try {
        const countResult = await db.query(
          'SELECT COUNT(*) as c FROM decisions WHERE project_id = ?',
          [project_id],
        );
        totalProjectDecisions = parseInt((countResult.rows[0] as Record<string, unknown>)?.c as string ?? '0', 10);
      } catch { /* ignore */ }

      if (totalProjectDecisions === 0) {
        hint = 'This project has no decisions yet. Record your first decision with POST /api/projects/:id/decisions or import from GitHub with the Import Wizard.';
      } else {
        hint = "No decisions matched the relevance threshold (0.5). Try a domain-specific agent name like 'architect', 'backend', or 'security', or lower the threshold with ?threshold=0.3";
      }
    }

      // Cache the result
    const responsePayload = {
      compile_request_id: compileRequestId,
      ...result,
      formatted_markdown: formattedMarkdown,
      context_hash: contextHash,
      feedback_hint: `Rate this context: POST /api/feedback/batch with compile_request_id=${compileRequestId}`,
      outcome_hint: `Report task results: POST /api/outcomes with compile_request_id=${compileRequestId}`,
      ...(policyNotices.length > 0 ? { policy_notices: policyNotices } : {}),
      ...(policySummary ? { policy_summary: policySummary } : {}),
      ...(() => {
        const hasBlockPolicy = (policyNotices ?? []).some((n: any) => n.enforcement === 'block');
        return hasBlockPolicy ? { policy_blocked: true } : {};
      })(),

      ...(hint ? { hint } : {}),
      ...(sessionMeta ? { session: sessionMeta } : {}),
      ...(roleSignal ? { role_signal: roleSignal } : {}),
      ...(roleSignal ? (() => {
        try {
          const sig = { abstain_probability: roleSignal.abstain_probability as number, relevance_score: roleSignal.relevance_score as number, rank_among_agents: roleSignal.rank as number } as Parameters<typeof computeRecommendedAction>[0];
          const actionSignal = computeRecommendedAction(sig);
          return {
            recommended_action: actionSignal.recommended_action,
            action_reason: actionSignal.action_reason,
            ...(actionSignal.override_to_agent ? { override_to_agent: actionSignal.override_to_agent } : {}),
          };
        } catch { return {}; }
      })() : {}),
      ...(debugInfo ? { debug: debugInfo } : {}),
      ...(contrastiveExplanations ? { contrastive_explanations: contrastiveExplanations } : {}),
      ...(teamInsights.length > 0 ? { team_insights: teamInsights } : {}),
      ...(communityPatterns && communityPatterns.length > 0
        ? { community_patterns: communityPatterns }
        : {}),
      ...(userFacts.length > 0 ? { user_facts: userFacts } : {}),
    };

    if (!debugInfo) {
      cache.set(
        compileKey(project_id, agent_name, taskHash),
        JSON.stringify(responsePayload),
        CACHE_TTL.COMPILE,
      ).catch(() => {});
    }

      // Compression: build condensed output when requested
    // Collect the action signal for condensing
    let actionSignal: ActionSignal | undefined;
    if (roleSignal) {
      try {
        const sig = { abstain_probability: roleSignal.abstain_probability as number, relevance_score: roleSignal.relevance_score as number, rank_among_agents: roleSignal.rank as number } as Parameters<typeof computeRecommendedAction>[0];
        actionSignal = computeRecommendedAction(sig);
      } catch { /* ignore */ }
    }

    // Collect role signals for team scores (from role_signal if present)
    const teamScores = roleSignal
      ? [{ agent_name, relevance_score: roleSignal.relevance_score as number }]
      : undefined;

    // Always compute compression metrics for metadata
    const compressionMetrics = computeCompressionMetrics(result, {
      contextPackage: result,
      recommendedAction: actionSignal,
      roleSignals: teamScores,
    });

      // Always compute compression ratio for the header
    const h0cForRatio = encodeH0C(result.decisions);
    const originalJson = result.formatted_json || JSON.stringify(result);
    const originalTokens = estimateTokens(originalJson);
    const compressedTokens = estimateTokens(h0cForRatio);
    const compressionRatio = compressedTokens > 0
      ? Math.round((originalTokens / compressedTokens) * 10) / 10
      : 0;
    c.header('X-Hipp0-Compression-Ratio', `${compressionRatio}x`);

      // H0C format: ultra-compact one-line-per-decision with tag dedup
    if (format === 'h0c') {
      c.header('X-Hipp0-Format', 'h0c');
      console.warn('[hipp0/compile-response]', { agent: agent_name, format: 'h0c', ratio: compressionRatio });
      const patternsH0C = encodeH0CPatterns(result.suggested_patterns ?? []);
      const h0cOutput = patternsH0C ? `${h0cForRatio}\n${patternsH0C}` : h0cForRatio;
      return c.text(h0cOutput);
    }

      // Ultra format: maximally compressed H0C with tiered detail
    if (format === 'ultra') {
      c.header('X-Hipp0-Format', 'ultra');
      const ultraOutput = encodeH0CUltra(result.decisions);
      const ultraTokens = estimateTokens(ultraOutput);
      const ultraRatio = ultraTokens > 0
        ? Math.round((originalTokens / ultraTokens) * 10) / 10
        : 0;
      c.header('X-Hipp0-Compression-Ratio', `${ultraRatio}x`);
      console.warn('[hipp0/compile-response]', { agent: agent_name, format: 'ultra', ratio: ultraRatio });
      return c.json({
        formatted_context: ultraOutput,
        token_count: ultraTokens,
        compression_ratio: ultraRatio,
        decisions_included: result.decisions_included,
        compile_request_id: compileRequestId,
      });
    }

      // Markdown format
    if (format === 'markdown') {
      c.header('X-Hipp0-Format', 'markdown');
      console.warn('[hipp0/compile-response]', { agent: agent_name, format: 'markdown' });
      let mdOutput = formattedMarkdown;
      if ((result.suggested_patterns ?? []).length > 0) {
        const patternLines = result.suggested_patterns.map(
          (p) => `- **${p.title}** (${Math.round(p.confidence * 100)}% confidence, ${p.source_count} projects) — ${p.description}`,
        );
        mdOutput += `\n\n## Suggested Patterns\n${patternLines.join('\n')}`;
      }
      return c.text(mdOutput);
    }

    if (format === 'condensed') {
      const condensed = condenseCompileResponse({
        contextPackage: result,
        recommendedAction: actionSignal,
        roleSignals: teamScores,
      });
      console.warn("[hipp0/compile-response]", { agent: agent_name, format: 'condensed', ratio: condensed.compression_ratio });
      return c.json(condensed);
    }

    if (format === 'both') {
      const condensed = condenseCompileResponse({
        contextPackage: result,
        recommendedAction: actionSignal,
        roleSignals: teamScores,
      });
      console.warn("[hipp0/compile-response]", { agent: agent_name, format: 'both', ratio: condensed.compression_ratio });
      return c.json({
        ...responsePayload,
        condensed_context: condensed.condensed_context,
        compression_metrics: compressionMetrics,
      });
    }

      // Response (full/json, default)
    c.header('X-Hipp0-Format', 'json');
    console.warn("[hipp0/compile-response]", { agent: agent_name, resultDecisions: (result.decisions ?? []).length, decisionsIncluded: result.decisions_included });
    return c.json({
      ...responsePayload,
      compression_metrics: compressionMetrics,
    });
      } catch (err: unknown) {
        __compileSuccess = false;
        throw err;
      } finally {
        // Always record metrics — even on error — with low-cardinality dimensions.
        const __duration = Date.now() - __compileStart;
        const __dims: Record<string, string | boolean> = {
          format: __compileFormat,
          success: __compileSuccess,
        };
        if (__compileAgent) __dims.agent_name = __compileAgent;
        if (__compileProject) __dims.project_id = __compileProject;
        recordHistogram(__metrics.compileDuration, __duration, __dims);
        recordHistogram(__metrics.compileDecisionsIncluded, __compileDecisionsIncluded, __dims);
        recordCounter(__metrics.compileCount, 1, __dims);
      }
    });
  });
}
