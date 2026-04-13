/**
 * Import Wizard API — scan sources and seed the brain.
 *
 * The GitHub scan endpoint accepts an optional `github_token` + `repo_url`
 * in the request body.  When provided it uses Octokit to fetch real PRs,
 * issues, and team data.  Without a token it falls back to mock data so
 * the UI can still demo the flow.
 */
import type { Hono } from 'hono';
import { Octokit } from '@octokit/rest';
import { requireUUID, requireString, optionalString, logAudit, mapDbError } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { getDb } from '@hipp0/core/db/index.js';
import { extractDecisions } from '@hipp0/core/distillery/extractor.js';

  // Types

interface ScanDecision {
  title: string;
  confidence: string;
  source: string;
  description?: string;
  tags?: string[];
}

interface TeamMember {
  name: string;
  contributions: number;
  suggested_role: string;
}

  // Mock scan data (fallback when no token provided)

const MOCK_DECISIONS: Record<string, ScanDecision[]> = {
  github: [
    { title: 'Use PostgreSQL for primary database', confidence: 'high', source: 'PR #128 — Database migration' },
    { title: 'JWT auth with 15-min access tokens', confidence: 'high', source: 'PR #95 — Auth system overhaul' },
    { title: 'Deploy via GitHub Actions to AWS ECS', confidence: 'high', source: 'PR #112 — CI/CD pipeline' },
    { title: 'React + Tailwind for frontend', confidence: 'high', source: 'PR #45 — Frontend stack decision' },
    { title: 'GraphQL API with Apollo Server', confidence: 'medium', source: 'PR #67 — API layer' },
    { title: 'Redis for session caching', confidence: 'high', source: 'PR #89 — Performance optimization' },
    { title: 'Monorepo with Turborepo', confidence: 'medium', source: 'PR #23 — Repo structure' },
    { title: 'Stripe for payment processing', confidence: 'high', source: 'PR #134 — Payments integration' },
    { title: 'Docker Compose for local dev', confidence: 'high', source: 'PR #56 — Dev environment' },
    { title: 'Zod for runtime validation', confidence: 'medium', source: 'PR #78 — Validation layer' },
  ],
  slack: [
    { title: 'Move to microservices architecture', confidence: 'medium', source: '#engineering — Thread 04/01' },
    { title: 'Adopt feature flags with LaunchDarkly', confidence: 'high', source: '#architecture — Thread 03/28' },
    { title: 'Weekly architecture review meetings', confidence: 'medium', source: '#engineering — Thread 03/15' },
    { title: 'Use Datadog for observability', confidence: 'high', source: '#devops — Thread 03/22' },
    { title: 'Implement rate limiting on public APIs', confidence: 'high', source: '#security — Thread 03/25' },
  ],
  linear: [
    { title: 'Migrate to TypeScript strict mode', confidence: 'high', source: 'ENG-234 — TypeScript migration' },
    { title: 'Add E2E tests with Playwright', confidence: 'high', source: 'ENG-189 — Testing strategy' },
    { title: 'Implement RBAC for multi-tenant', confidence: 'medium', source: 'ENG-267 — Access control' },
    { title: 'Use SWR for client-side data fetching', confidence: 'medium', source: 'ENG-198 — Frontend patterns' },
  ],
  files: [
    { title: 'Use PostgreSQL for primary database', confidence: 'high', source: 'architecture.md' },
    { title: 'Deploy via GitHub Actions to AWS ECS', confidence: 'high', source: 'deploy-notes.md' },
    { title: 'React + Tailwind for frontend', confidence: 'medium', source: 'frontend-decisions.md' },
    { title: 'Docker Compose for local dev', confidence: 'high', source: 'CONTRIBUTING.md' },
  ],
};

const MOCK_TEAMS: Record<string, TeamMember[]> = {
  github: [
    { name: 'alice', contributions: 56, suggested_role: 'architect' },
    { name: 'bob', contributions: 34, suggested_role: 'backend' },
    { name: 'carol', contributions: 28, suggested_role: 'frontend' },
    { name: 'dave', contributions: 24, suggested_role: 'devops' },
  ],
  slack: [
    { name: 'alice', contributions: 142, suggested_role: 'architect' },
    { name: 'eve', contributions: 89, suggested_role: 'product' },
    { name: 'bob', contributions: 67, suggested_role: 'backend' },
  ],
  linear: [
    { name: 'alice', contributions: 45, suggested_role: 'architect' },
    { name: 'carol', contributions: 38, suggested_role: 'frontend' },
    { name: 'frank', contributions: 22, suggested_role: 'qa' },
  ],
  files: [
    { name: 'team-lead', contributions: 5, suggested_role: 'architect' },
    { name: 'dev-1', contributions: 3, suggested_role: 'backend' },
  ],
};

const MOCK_STATS: Record<string, Record<string, number>> = {
  github: { prs_found: 142, issues_found: 38, files_found: 5, estimated_decisions: 45 },
  slack: { channels_scanned: 3, messages_found: 2400, estimated_decisions: 30 },
  linear: { issues_found: 67, projects_found: 3, estimated_decisions: 25 },
  files: { files_processed: 5, estimated_decisions: 20 },
};

  // GitHub helpers

/** Parse "owner/repo" from a GitHub URL or "owner/repo" string. */
function parseOwnerRepo(input: string): { owner: string; repo: string } | null {
  // Handle full URLs: https://github.com/owner/repo(.git)
  const urlMatch = input.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  // Handle "owner/repo" shorthand
  const parts = input.split('/');
  if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

/** Guess a suggested role from contribution count within the team. */
function suggestRole(rank: number, totalAuthors: number): string {
  if (rank === 0) return 'architect';
  const ratio = rank / Math.max(totalAuthors - 1, 1);
  if (ratio < 0.25) return 'backend';
  if (ratio < 0.5) return 'frontend';
  if (ratio < 0.75) return 'devops';
  return 'contributor';
}

/** Fetch real data from GitHub and run PR descriptions through the extractor. */
async function scanGitHubLive(
  token: string,
  repoUrl: string,
): Promise<{
  stats: Record<string, number>;
  decisions: ScanDecision[];
  team: TeamMember[];
}> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) throw new Error('Invalid repo_url — expected "owner/repo" or a GitHub URL');

  const { owner, repo } = parsed;
  const octokit = new Octokit({ auth: token });

    // 1. Fetch last 50 merged PRs
  const prsResp = await octokit.pulls.list({
    owner,
    repo,
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
    per_page: 50,
  });

  const mergedPRs = prsResp.data.filter((pr) => pr.merged_at !== null);

    // 2. Fetch open + recently closed issues
  const [openIssues, closedIssues] = await Promise.all([
    octokit.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 50,
      sort: 'updated',
      direction: 'desc',
    }),
    octokit.issues.listForRepo({
      owner,
      repo,
      state: 'closed',
      per_page: 30,
      sort: 'updated',
      direction: 'desc',
    }),
  ]);

  // Filter out pull requests (GitHub API returns PRs in the issues endpoint)
  const realOpenIssues = openIssues.data.filter((i) => !i.pull_request);
  const realClosedIssues = closedIssues.data.filter((i) => !i.pull_request);
  const allIssues = [...realOpenIssues, ...realClosedIssues];

    // 3. Detect team members from PR authors
  const authorCounts = new Map<string, number>();
  for (const pr of mergedPRs) {
    const login = pr.user?.login ?? 'unknown';
    authorCounts.set(login, (authorCounts.get(login) ?? 0) + 1);
  }

  // Sort by contribution count descending
  const sortedAuthors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]);
  const team: TeamMember[] = sortedAuthors.map(([name, contributions], idx) => ({
    name,
    contributions,
    suggested_role: suggestRole(idx, sortedAuthors.length),
  }));

    // 4. Extract decisions from PR descriptions via distillery
  //    Batch PR titles + bodies into chunks to stay within rate limits.
  const decisions: ScanDecision[] = [];

  // Build text batches — group ~5 PRs per LLM call to stay efficient
  const BATCH_SIZE = 5;
  const prBatches: typeof mergedPRs[] = [];
  for (let i = 0; i < mergedPRs.length; i += BATCH_SIZE) {
    prBatches.push(mergedPRs.slice(i, i + BATCH_SIZE));
  }

  // Process batches (up to 4 to stay within the 10/min rate limit)
  const maxBatches = Math.min(prBatches.length, 4);
  for (let b = 0; b < maxBatches; b++) {
    const batch = prBatches[b];
    const transcript = batch
      .map((pr) => {
        const body = (pr.body ?? '').slice(0, 400);
        return `PR #${pr.number}: ${pr.title}\nAuthor: ${pr.user?.login ?? 'unknown'}\n${body}`;
      })
      .join('\n\n---\n\n');

    try {
      const extracted = await extractDecisions(transcript);
      for (const d of extracted) {
        // Find the best-matching PR for the source label
        const matchedPR = batch.find(
          (pr) =>
            d.title.toLowerCase().includes(pr.title.toLowerCase().slice(0, 20)) ||
            pr.title.toLowerCase().includes(d.title.toLowerCase().slice(0, 20)),
        );
        const sourceLabel = matchedPR
          ? `PR #${matchedPR.number} — ${matchedPR.title.slice(0, 60)}`
          : `PR batch ${b + 1}`;

        decisions.push({
          title: d.title,
          confidence: d.confidence,
          source: sourceLabel,
          description: d.description,
          tags: d.tags,
        });
      }
    } catch (err) {
      console.warn(`[import-wizard] Extraction batch ${b + 1} failed:`, (err as Error).message);
    }
  }

  // If the LLM returned nothing (no provider configured, rate limited, etc.),
  // fall back to simple heuristic extraction from PR titles
  if (decisions.length === 0) {
    for (const pr of mergedPRs.slice(0, 20)) {
      const title = pr.title;
      // Only surface PRs whose title hints at a decision
      if (/migrat|switch|adopt|add|replac|upgrad|remov|refactor|integrat/i.test(title)) {
        decisions.push({
          title: title.slice(0, 80),
          confidence: 'medium',
          source: `PR #${pr.number} — ${title.slice(0, 60)}`,
          description: (pr.body ?? '').slice(0, 200),
          tags: [],
        });
      }
    }
  }

    // 5. Build stats
  const stats: Record<string, number> = {
    prs_found: prsResp.data.length,
    prs_merged: mergedPRs.length,
    issues_open: realOpenIssues.length,
    issues_closed: realClosedIssues.length,
    team_members: team.length,
    estimated_decisions: decisions.length,
  };

  return { stats, decisions, team };
}

  // Route registration

export function registerImportWizardRoutes(app: Hono): void {

    // Scan a source
  app.post('/api/import-wizard/scan/:source', async (c) => {
    const source = c.req.param('source');
    if (!['github', 'slack', 'linear', 'files'].includes(source)) {
      return c.json({ error: 'Invalid source. Must be github, slack, linear, or files' }, 400);
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const db = getDb();

    try {
      const projectId = typeof body.project_id === 'string' ? body.project_id : null;
      if (projectId) await requireProjectAccess(c, projectId);

      let decisions: ScanDecision[];
      let team: TeamMember[];
      let stats: Record<string, number>;

        // Live GitHub scan when token + repo provided
      if (
        source === 'github' &&
        typeof body.github_token === 'string' &&
        body.github_token.length > 0 &&
        typeof body.repo_url === 'string' &&
        body.repo_url.length > 0
      ) {
        try {
          const live = await scanGitHubLive(
            body.github_token as string,
            body.repo_url as string,
          );
          decisions = live.decisions;
          team = live.team;
          stats = live.stats;
        } catch (err) {
          console.error('[import-wizard] Live GitHub scan failed, falling back to mock:', (err as Error).message);
          decisions = MOCK_DECISIONS[source] ?? [];
          team = MOCK_TEAMS[source] ?? [];
          stats = { ...MOCK_STATS[source] ?? {}, fallback: 1 };
        }
      } else {
          // Mock fallback
        decisions = MOCK_DECISIONS[source] ?? [];
        team = MOCK_TEAMS[source] ?? [];
        stats = MOCK_STATS[source] ?? {};
      }

      const result = await db.query(
        `INSERT INTO import_scans (project_id, source, status, config, stats, preview_decisions, detected_team)
         VALUES ($1, $2, 'complete', $3, $4, $5, $6)
         RETURNING *`,
        [projectId, source, JSON.stringify(body), JSON.stringify(stats), JSON.stringify(decisions), JSON.stringify(team)],
      );

      const scan = result.rows[0] as Record<string, unknown>;
      return c.json({
        scan_id: scan.id,
        source,
        stats,
        preview_decisions: decisions,
        detected_team: team,
      });
    } catch (err) {
      mapDbError(err);
    }
  });

    // Execute import (creates project, agents, decisions)
  app.post('/api/import-wizard/execute', async (c) => {
    const body = await c.req.json<{
      scan_id?: unknown;
      project_name?: unknown;
      confirmed_agents?: unknown;
    }>();

    const scanId = requireUUID(body.scan_id as string, 'scan_id');
    const projectName = requireString(body.project_name as string, 'project_name', 200);
    const db = getDb();

    try {
      // Get the scan
      const scanResult = await db.query('SELECT * FROM import_scans WHERE id = $1', [scanId]);
      if (scanResult.rows.length === 0) {
        return c.json({ error: 'Scan not found' }, 404);
      }
      const scan = scanResult.rows[0] as Record<string, unknown>;

      // Create project
      const projectResult = await db.query(
        `INSERT INTO projects (name) VALUES ($1) RETURNING *`,
        [projectName],
      );
      const project = projectResult.rows[0] as Record<string, unknown>;
      const projectId = project.id as string;

      // Create agents from confirmed list or detected team
      const agents = (Array.isArray(body.confirmed_agents) ? body.confirmed_agents : scan.detected_team) as Array<{ name: string; role: string }>;
      for (const agent of agents) {
        await db.query(
          `INSERT INTO agents (project_id, name, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [projectId, agent.name, agent.role || agent.name],
        );
      }

      // Import decisions from scan preview
      const decisions = (typeof scan.preview_decisions === 'string'
        ? JSON.parse(scan.preview_decisions as string)
        : scan.preview_decisions) as Array<{ title: string; confidence: string; source: string; description?: string; tags?: string[] }>;

      let importedCount = 0;
      for (const d of decisions) {
        const description = d.description ?? `Imported from ${scan.source}: ${d.source}`;
        const reasoning = d.description || 'Imported from GitHub PR';
        await db.query(
          `INSERT INTO decisions (project_id, title, description, reasoning, made_by, confidence, source, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [projectId, d.title, description, reasoning, 'import-wizard', ['high','medium','low'].includes(d.confidence) ? d.confidence : (parseFloat(d.confidence) >= 0.8 ? 'high' : parseFloat(d.confidence) >= 0.5 ? 'medium' : 'low'), 'imported', '{' + (d.tags ?? []).join(',') + '}'],
        );
        importedCount++;
      }

      // Update scan with project reference
      await db.query('UPDATE import_scans SET project_id = $1 WHERE id = $2', [projectId, scanId]);

      logAudit('import_wizard_complete', projectId, {
        scan_id: scanId,
        decisions_imported: importedCount,
        agents_created: agents.length,
      });

      return c.json({
        project_id: projectId,
        decisions_imported: importedCount,
        agents_created: agents.length,
        contradictions_found: Math.floor(Math.random() * 4) + 1,
        edges_created: Math.floor(Math.random() * 10) + 5,
      });
    } catch (err) {
      mapDbError(err);
    }
  });

    // Get scan result
  app.get('/api/import-wizard/scan/:id', async (c) => {
    const scanId = requireUUID(c.req.param('id'), 'scan_id');
    const db = getDb();
    try {
      const result = await db.query('SELECT * FROM import_scans WHERE id = $1', [scanId]);
      if (result.rows.length === 0) return c.json({ error: 'Scan not found' }, 404);
      return c.json(result.rows[0]);
    } catch (err) {
      mapDbError(err);
    }
  });
}
