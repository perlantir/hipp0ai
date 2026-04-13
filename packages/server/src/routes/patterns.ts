/**
 * Pattern Intelligence Routes
 *
 * GET  /api/projects/:id/patterns  — Get relevant patterns for this project
 * POST /api/patterns/extract       — Trigger extraction (admin)
 */

import type { Hono } from 'hono';
import { getProjectPatterns, extractPatterns } from '@hipp0/core/intelligence/pattern-extractor.js';
import { isAuthRequired } from '../auth/middleware.js';
import { safeEmit } from '../events/event-stream.js';

export function registerPatternRoutes(app: Hono): void {
  // Get patterns relevant to this project (only surfaced if 5+ tenants)
  app.get('/api/projects/:id/patterns', async (c) => {
    const projectId = c.req.param('id');
    try {
      const patterns = await getProjectPatterns(projectId);
      if (Array.isArray(patterns) && patterns.length > 0) {
        safeEmit('pattern.detected', projectId, {
          pattern_count: patterns.length,
          patterns: patterns.slice(0, 5).map((p) => ({
            pattern_type: p.pattern_type,
            description: p.description,
            confidence: p.confidence,
          })),
        });
      }
      return c.json(patterns);
    } catch (err) {
      console.warn('[hipp0:patterns] Failed to get patterns:', (err as Error).message);
      return c.json([]);
    }
  });

  // Trigger pattern extraction manually (admin)
  app.post('/api/patterns/extract', async (c) => {
    // Require authentication — reject if auth is required and no user context
    if (isAuthRequired()) {
      const user = c.get('user' as never) as { role?: string } | undefined;
      if (!user) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
      }
    }

    try {
      const result = await extractPatterns();
      return c.json(result);
    } catch (err) {
      console.error('[hipp0:patterns] Extraction failed:', (err as Error).message);
      return c.json({ error: 'Pattern extraction failed' }, 500);
    }
  });
}
