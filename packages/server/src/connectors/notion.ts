/**
 * Notion Integration Connector — Import decisions from Notion pages.
 *
 * Flow:
 *   1. List pages in a workspace or database (via search API).
 *   2. Fetch each page's block children.
 *   3. Scan blocks for decision-like patterns (headings, callouts, paragraphs).
 *   4. Insert extracted decisions into Hipp0 as imported decisions.
 *
 * Uses the Notion API directly (no SDK) via native fetch.
 * Token is passed per-request (no persistence). Rate limited to ~60 req/min.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';
import { logAudit, generateEmbedding } from '../routes/validation.js';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/* ------------------------------------------------------------------ */
/*  Decision extraction patterns                                       */
/* ------------------------------------------------------------------ */

const HEADING_DECISION_PATTERN =
  /^\s*(decision|chose|chosen|going with|we(?:'re| are| ve| have) going with|use|using|adopt|adopted)\b/i;

const PARAGRAPH_DECISION_PATTERNS: RegExp[] = [
  /\bwe decided\b/i,
  /\bwe chose\b/i,
  /\bwe(?:'re| are) going with\b/i,
  /\bwe agreed\b/i,
  /\bagreed to\b/i,
  /\bgoing with\b/i,
  /\bdecision\s*:/i,
  /\bwill use\b.*\binstead\b/i,
  /\bchose\b.*\bover\b/i,
];

const CALLOUT_DECISION_LABELS =
  /\b(decision|resolved|agreed|conclusion|outcome)\b/i;

export interface ExtractedDecision {
  title: string;
  description: string;
  reasoning: string;
  made_by: string;
  tags: string[];
  source_url?: string;
  source_ref?: string;
}

/* ------------------------------------------------------------------ */
/*  Rate limiter — sliding window of 60 req/min                        */
/* ------------------------------------------------------------------ */

const _notionRequestTimestamps: number[] = [];
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  while (_notionRequestTimestamps.length && _notionRequestTimestamps[0] < oneMinuteAgo) {
    _notionRequestTimestamps.shift();
  }
  if (_notionRequestTimestamps.length >= 60) {
    const waitMs = _notionRequestTimestamps[0] + 60_000 - now + 50;
    await new Promise((r) => setTimeout(r, waitMs));
    return rateLimit();
  }
  _notionRequestTimestamps.push(now);
}

/* ------------------------------------------------------------------ */
/*  API helpers                                                        */
/* ------------------------------------------------------------------ */

async function notionFetch<T = unknown>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  await rateLimit();
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return notionFetch(token, path, init);
  }

  if (res.status === 401) {
    throw new Error('Notion token invalid or expired');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text.slice(0, 300)}`);
  }

  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/*  Public: List pages                                                 */
/* ------------------------------------------------------------------ */

export interface NotionPageSummary {
  id: string;
  title: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  author?: string;
  database_id?: string;
}

function extractTitleFromPage(page: Record<string, unknown>): string {
  const props = (page.properties as Record<string, unknown>) ?? {};
  for (const [_k, v] of Object.entries(props)) {
    const prop = v as Record<string, unknown>;
    if (prop.type === 'title') {
      const title = (prop.title as Array<{ plain_text?: string }>) ?? [];
      return title.map((t) => t.plain_text ?? '').join('').trim() || 'Untitled';
    }
  }
  // Fallback: some workspace pages use "Name" property
  return 'Untitled';
}

/**
 * List pages in a workspace, optionally filtering to a specific database.
 * Uses Notion's search API for workspace-wide listing, or database query
 * for database-scoped listing.
 */
export async function listNotionPages(
  token: string,
  databaseId?: string,
): Promise<NotionPageSummary[]> {
  if (databaseId) {
    const data = await notionFetch<{
      results: Array<Record<string, unknown>>;
    }>(token, `/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100 }),
    });

    return data.results.map((p) => ({
      id: p.id as string,
      title: extractTitleFromPage(p),
      url: (p.url as string) ?? '',
      created_time: (p.created_time as string) ?? '',
      last_edited_time: (p.last_edited_time as string) ?? '',
      author: ((p.created_by as Record<string, unknown>)?.id as string) ?? undefined,
      database_id: databaseId,
    }));
  }

  // Workspace-wide search for pages
  const data = await notionFetch<{
    results: Array<Record<string, unknown>>;
  }>(token, '/search', {
    method: 'POST',
    body: JSON.stringify({
      filter: { value: 'page', property: 'object' },
      page_size: 100,
    }),
  });

  return data.results.map((p) => ({
    id: p.id as string,
    title: extractTitleFromPage(p),
    url: (p.url as string) ?? '',
    created_time: (p.created_time as string) ?? '',
    last_edited_time: (p.last_edited_time as string) ?? '',
    author: ((p.created_by as Record<string, unknown>)?.id as string) ?? undefined,
  }));
}

/* ------------------------------------------------------------------ */
/*  Public: Fetch a single page with all blocks                        */
/* ------------------------------------------------------------------ */

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  author: string;
  tags: string[];
  blocks: Array<Record<string, unknown>>;
}

export async function fetchNotionPage(
  token: string,
  pageId: string,
): Promise<NotionPage> {
  // Fetch page metadata
  const page = await notionFetch<Record<string, unknown>>(token, `/pages/${pageId}`);
  const title = extractTitleFromPage(page);
  const url = (page.url as string) ?? '';
  const author = ((page.created_by as Record<string, unknown>)?.id as string) ?? 'notion';

  // Pull tags from multi_select / select properties
  const tags: string[] = [];
  const props = (page.properties as Record<string, unknown>) ?? {};
  for (const v of Object.values(props)) {
    const prop = v as Record<string, unknown>;
    if (prop.type === 'multi_select') {
      const vals = (prop.multi_select as Array<{ name?: string }>) ?? [];
      for (const t of vals) {
        if (t.name) tags.push(t.name.toLowerCase());
      }
    } else if (prop.type === 'select') {
      const sel = prop.select as { name?: string } | null;
      if (sel?.name) tags.push(sel.name.toLowerCase());
    }
  }

  // Fetch all blocks (paginated)
  const blocks: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  let guard = 0;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await notionFetch<{
      results: Array<Record<string, unknown>>;
      next_cursor: string | null;
      has_more: boolean;
    }>(token, `/blocks/${pageId}/children${qs}`);
    blocks.push(...data.results);
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    guard++;
  } while (cursor && guard < 20); // hard cap at 2000 blocks

  return { id: pageId, title, url, author, tags, blocks };
}

/* ------------------------------------------------------------------ */
/*  Block rich_text → plain text helper                                */
/* ------------------------------------------------------------------ */

function richTextToPlain(rt: unknown): string {
  if (!Array.isArray(rt)) return '';
  return rt
    .map((s) => (s as { plain_text?: string }).plain_text ?? '')
    .join('');
}

function blockText(block: Record<string, unknown>): string {
  const type = block.type as string;
  if (!type) return '';
  const inner = block[type] as Record<string, unknown> | undefined;
  if (!inner) return '';
  return richTextToPlain(inner.rich_text);
}

/* ------------------------------------------------------------------ */
/*  Public: Extract decisions from a fetched page                      */
/* ------------------------------------------------------------------ */

export function extractDecisionsFromPage(page: NotionPage): ExtractedDecision[] {
  const results: ExtractedDecision[] = [];
  const blocks = page.blocks;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const type = (block.type as string) ?? '';

    // Heading blocks: heading_2, heading_3 matching decision pattern
    if (type === 'heading_2' || type === 'heading_3') {
      const headingText = blockText(block).trim();
      if (!headingText) continue;
      if (!HEADING_DECISION_PATTERN.test(headingText)) continue;

      // Pull the next 1–2 paragraphs as description
      const descParts: string[] = [];
      for (let j = i + 1; j < Math.min(i + 4, blocks.length); j++) {
        const next = blocks[j];
        const nextType = (next.type as string) ?? '';
        if (nextType === 'heading_1' || nextType === 'heading_2' || nextType === 'heading_3') break;
        if (nextType === 'paragraph') {
          const txt = blockText(next).trim();
          if (txt) descParts.push(txt);
          if (descParts.length >= 2) break;
        }
      }

      const description = descParts.join('\n\n') || headingText;
      results.push({
        title: headingText.slice(0, 500),
        description: description.slice(0, 10000),
        reasoning: description.slice(0, 10000),
        made_by: page.author || 'notion',
        tags: [...page.tags, 'notion'],
        source_url: page.url,
        source_ref: `notion:page:${page.id}`,
      });
      continue;
    }

    // Callout and toggle blocks with decision-like labels
    if (type === 'callout' || type === 'toggle') {
      const text = blockText(block).trim();
      if (!text) continue;
      if (!CALLOUT_DECISION_LABELS.test(text) && !PARAGRAPH_DECISION_PATTERNS.some((p) => p.test(text))) continue;

      // Take the first sentence as title, full text as description
      const firstSentence = text.split(/[.!?]\s/)[0].slice(0, 500);
      results.push({
        title: firstSentence || text.slice(0, 100),
        description: text.slice(0, 10000),
        reasoning: text.slice(0, 10000),
        made_by: page.author || 'notion',
        tags: [...page.tags, 'notion'],
        source_url: page.url,
        source_ref: `notion:page:${page.id}`,
      });
      continue;
    }

    // Paragraph with explicit decision wording
    if (type === 'paragraph') {
      const text = blockText(block).trim();
      if (!text || text.length < 20) continue;
      if (!PARAGRAPH_DECISION_PATTERNS.some((p) => p.test(text))) continue;

      const firstSentence = text.split(/[.!?]\s/)[0].slice(0, 500);
      results.push({
        title: firstSentence || text.slice(0, 100),
        description: text.slice(0, 10000),
        reasoning: text.slice(0, 10000),
        made_by: page.author || 'notion',
        tags: [...page.tags, 'notion'],
        source_url: page.url,
        source_ref: `notion:page:${page.id}`,
      });
    }
  }

  // Also consider the page title itself if it looks like a decision
  const pageTitle = page.title ?? '';
  if (pageTitle && HEADING_DECISION_PATTERN.test(pageTitle)) {
    const firstPara = blocks.find((b) => (b.type as string) === 'paragraph');
    const description = firstPara ? blockText(firstPara).trim() : pageTitle;
    results.unshift({
      title: pageTitle.slice(0, 500),
      description: description.slice(0, 10000) || pageTitle,
      reasoning: description.slice(0, 10000) || pageTitle,
      made_by: page.author || 'notion',
      tags: [...page.tags, 'notion'],
      source_url: page.url,
      source_ref: `notion:page:${page.id}`,
    });
  }

  return dedupeDecisions(results);
}

function dedupeDecisions(decisions: ExtractedDecision[]): ExtractedDecision[] {
  const seen = new Set<string>();
  const out: ExtractedDecision[] = [];
  for (const d of decisions) {
    const key = d.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Public: Full sync flow                                             */
/* ------------------------------------------------------------------ */

export interface SyncOptions {
  dryRun?: boolean;
  limit?: number;
}

export interface SyncResult {
  pages_scanned: number;
  decisions_found: number;
  decisions_imported: number;
  errors: string[];
  preview?: ExtractedDecision[];
}

export async function syncNotionToHipp0(
  projectId: string,
  token: string,
  databaseId?: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const errors: string[] = [];
  const preview: ExtractedDecision[] = [];
  let pagesScanned = 0;
  let decisionsFound = 0;
  let decisionsImported = 0;

  console.warn(`[hipp0/notion] Sync starting project=${projectId} db=${databaseId ?? '(workspace)'}`);

  let pages: NotionPageSummary[];
  try {
    pages = await listNotionPages(token, databaseId);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[hipp0/notion] Failed to list pages: ${msg}`);
    return { pages_scanned: 0, decisions_found: 0, decisions_imported: 0, errors: [msg] };
  }

  const limit = options.limit ?? 50;
  const target = pages.slice(0, limit);

  for (const summary of target) {
    pagesScanned++;
    try {
      const page = await fetchNotionPage(token, summary.id);
      const extracted = extractDecisionsFromPage(page);
      decisionsFound += extracted.length;

      if (extracted.length === 0) continue;

      console.warn(`[hipp0/notion] Page "${page.title}" → ${extracted.length} decision(s)`);

      if (options.dryRun) {
        preview.push(...extracted);
        continue;
      }

      for (const d of extracted) {
        try {
          await insertImportedDecision(projectId, d);
          decisionsImported++;
        } catch (err) {
          errors.push(`insert "${d.title}": ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`page ${summary.id}: ${(err as Error).message}`);
    }
  }

  logAudit('notion_sync', projectId, {
    database_id: databaseId ?? null,
    pages_scanned: pagesScanned,
    decisions_found: decisionsFound,
    decisions_imported: decisionsImported,
    dry_run: options.dryRun ?? false,
  });

  console.warn(
    `[hipp0/notion] Sync complete: ${pagesScanned} pages, ${decisionsFound} found, ${decisionsImported} imported`,
  );

  return {
    pages_scanned: pagesScanned,
    decisions_found: decisionsFound,
    decisions_imported: decisionsImported,
    errors,
    preview: options.dryRun ? preview : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Shared: Insert an extracted decision as an imported decision       */
/* ------------------------------------------------------------------ */

export async function insertImportedDecision(
  projectId: string,
  d: ExtractedDecision,
): Promise<string> {
  const db = getDb();
  const id = randomUUID();

  // Best-effort embedding (generateEmbedding returns null on failure)
  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(`${d.title}\n${d.description}\n${d.reasoning}`);
  } catch { /* non-fatal */ }

  await db.query(
    `INSERT INTO decisions
     (id, project_id, title, description, reasoning, made_by, source, confidence, status,
      alternatives_considered, affects, tags, assumptions, open_questions, dependencies,
      confidence_decay_rate, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'imported', 'medium', 'active',
             '[]', ?, ?, '[]', '[]', '[]', 0, ?)`,
    [
      id,
      projectId,
      d.title,
      d.description,
      d.reasoning,
      d.made_by,
      db.arrayParam([]),
      db.arrayParam(d.tags),
      JSON.stringify({
        import_source: d.source_ref?.split(':')[0] ?? 'import',
        source_url: d.source_url ?? null,
        source_ref: d.source_ref ?? null,
      }),
    ],
  );

  // Best-effort: store embedding if the table exists
  if (embedding) {
    try {
      await db.query(
        `INSERT INTO decision_embeddings (decision_id, embedding) VALUES (?, ?)
         ON CONFLICT (decision_id) DO UPDATE SET embedding = excluded.embedding`,
        [id, JSON.stringify(embedding)],
      );
    } catch { /* embedding table may not exist */ }
  }

  return id;
}
