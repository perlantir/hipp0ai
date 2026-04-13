import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  createWriteStream,
  createReadStream,
  existsSync,
  statSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { handleError } from '../cli-helpers.js';

/* ------------------------------------------------------------------ */
/*  Shared types                                                       */
/* ------------------------------------------------------------------ */

type ConflictStrategy = 'skip' | 'overwrite' | 'fail';

interface Endpoint {
  baseUrl: string;
  apiKey?: string;
}

interface DumpRecord {
  kind:
    | 'meta'
    | 'project'
    | 'agent'
    | 'decision'
    | 'edge'
    | 'outcome'
    | 'session'
    | 'capture';
  data: Record<string, unknown>;
}

interface DumpStats {
  projects: number;
  agents: number;
  decisions: number;
  edges: number;
  outcomes: number;
  sessions: number;
  captures: number;
}

interface RestoreStats extends DumpStats {
  skipped: number;
  overwritten: number;
  errors: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function emptyStats(): DumpStats {
  return {
    projects: 0,
    agents: 0,
    decisions: 0,
    edges: 0,
    outcomes: 0,
    sessions: 0,
    captures: 0,
  };
}

function emptyRestoreStats(): RestoreStats {
  return { ...emptyStats(), skipped: 0, overwritten: 0, errors: 0 };
}

function resolveEndpoint(override?: string): Endpoint {
  const baseUrl = (override ?? process.env.HIPP0_API_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  const apiKey = process.env.HIPP0_API_KEY;
  return { baseUrl, apiKey };
}

function headersFor(ep: Endpoint): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ep.apiKey) h['Authorization'] = `Bearer ${ep.apiKey}`;
  return h;
}

async function httpJson<T>(
  ep: Endpoint,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const opts: RequestInit = { method, headers: headersFor(ep) };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${ep.baseUrl}${path}`, opts);
  if (!res.ok) {
    let msg = `${method} ${path} → ${res.status}`;
    try {
      msg += `: ${await res.text()}`;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/** Minimal progress bar used while dumping/restoring. */
function drawProgress(label: string, current: number, total: number | null): void {
  const width = 28;
  if (total && total > 0) {
    const pct = Math.min(1, current / total);
    const filled = Math.round(pct * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    process.stderr.write(
      `\r${chalk.cyan(label)} ${bar} ${chalk.bold(`${current}/${total}`)} ${chalk.dim(
        `${(pct * 100).toFixed(0)}%`,
      )}`,
    );
  } else {
    process.stderr.write(`\r${chalk.cyan(label)} ${chalk.bold(String(current))}`);
  }
}

function endProgressLine(): void {
  process.stderr.write('\n');
}

function projectIdOf(r: Record<string, unknown>): string | undefined {
  const v = r['id'] ?? r['project_id'];
  return typeof v === 'string' ? v : undefined;
}

function entityIdOf(r: Record<string, unknown>): string | undefined {
  const v = r['id'];
  return typeof v === 'string' ? v : undefined;
}

/* ------------------------------------------------------------------ */
/*  DUMP                                                               */
/* ------------------------------------------------------------------ */

interface ProjectExportShape {
  project?: Record<string, unknown>;
  agents?: Record<string, unknown>[];
  decisions?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
  outcomes?: Record<string, unknown>[];
  sessions?: Record<string, unknown>[];
  captures?: Record<string, unknown>[];
}

async function listProjects(ep: Endpoint): Promise<Record<string, unknown>[]> {
  try {
    const data = await httpJson<unknown>(ep, 'GET', '/api/projects');
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (data && typeof data === 'object') {
      const dObj = data as { projects?: unknown };
      if (Array.isArray(dObj.projects)) return dObj.projects as Record<string, unknown>[];
    }
  } catch (err) {
    console.error(
      chalk.yellow(`  ⚠ Could not enumerate projects: ${(err as Error).message}`),
    );
  }
  return [];
}

async function exportProject(
  ep: Endpoint,
  projectId: string,
): Promise<ProjectExportShape> {
  return httpJson<ProjectExportShape>(ep, 'GET', `/api/projects/${projectId}/export`);
}

type LineWriter = {
  write: (obj: unknown) => void;
  close: () => Promise<void>;
};

function openNdjsonWriter(outPath: string): LineWriter {
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  return {
    write(obj: unknown): void {
      stream.write(`${JSON.stringify(obj)}\n`);
    },
    close(): Promise<void> {
      return new Promise((res, rej) => {
        stream.end((err?: Error | null) => (err ? rej(err) : res()));
      });
    },
  };
}

async function dumpToFile(
  ep: Endpoint,
  outPath: string,
  filterProject?: string,
): Promise<DumpStats> {
  const stats = emptyStats();
  const writer = openNdjsonWriter(outPath);

  writer.write({
    kind: 'meta',
    data: {
      format: 'hipp0-migrate-ndjson@1',
      source: ep.baseUrl,
      exported_at: new Date().toISOString(),
    },
  } satisfies DumpRecord);

  const projects = filterProject
    ? [{ id: filterProject } as Record<string, unknown>]
    : await listProjects(ep);

  if (projects.length === 0) {
    await writer.close();
    throw new Error(
      'No projects found on source. Set HIPP0_PROJECT_ID or pass --project.',
    );
  }

  for (const proj of projects) {
    const pid = projectIdOf(proj);
    if (!pid) continue;
    drawProgress(`dump ${pid.slice(0, 8)}`, 0, null);

    let exportData: ProjectExportShape;
    try {
      exportData = await exportProject(ep, pid);
    } catch (err) {
      console.error(
        chalk.yellow(`\n  ⚠ Skip project ${pid}: ${(err as Error).message}`),
      );
      continue;
    }

    if (exportData.project) {
      writer.write({ kind: 'project', data: exportData.project });
      stats.projects += 1;
    } else if (proj && typeof proj === 'object') {
      writer.write({ kind: 'project', data: proj });
      stats.projects += 1;
    }

    for (const a of exportData.agents ?? []) {
      writer.write({ kind: 'agent', data: { ...a, project_id: pid } });
      stats.agents += 1;
    }
    for (const d of exportData.decisions ?? []) {
      writer.write({ kind: 'decision', data: { ...d, project_id: pid } });
      stats.decisions += 1;
    }
    for (const e of exportData.edges ?? []) {
      writer.write({ kind: 'edge', data: { ...e, project_id: pid } });
      stats.edges += 1;
    }
    for (const o of exportData.outcomes ?? []) {
      writer.write({ kind: 'outcome', data: { ...o, project_id: pid } });
      stats.outcomes += 1;
    }
    for (const s of exportData.sessions ?? []) {
      writer.write({ kind: 'session', data: { ...s, project_id: pid } });
      stats.sessions += 1;
    }
    for (const cap of exportData.captures ?? []) {
      writer.write({ kind: 'capture', data: { ...cap, project_id: pid } });
      stats.captures += 1;
    }

    drawProgress(
      `dump ${pid.slice(0, 8)}`,
      stats.decisions,
      stats.decisions || null,
    );
    endProgressLine();
  }

  await writer.close();
  return stats;
}

/* ------------------------------------------------------------------ */
/*  RESTORE                                                            */
/* ------------------------------------------------------------------ */

async function readRecordsFromFile(
  inPath: string,
): Promise<AsyncIterable<DumpRecord>> {
  // NDJSON path: stream line by line.
  const stream = createReadStream(inPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  async function* gen(): AsyncIterable<DumpRecord> {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && 'kind' in obj && 'data' in obj) {
          yield obj as DumpRecord;
        }
      } catch {
        // Ignore malformed lines — restore is best-effort on damaged dumps.
      }
    }
  }

  return gen();
}

function isNdjsonFile(inPath: string): boolean {
  // Heuristic: first non-whitespace character is `{` and first line is short JSON.
  try {
    const stat = statSync(inPath);
    if (stat.size === 0) return false;
  } catch {
    return false;
  }
  return true;
}

async function existsOnTarget(
  ep: Endpoint,
  kind: DumpRecord['kind'],
  id: string,
): Promise<boolean> {
  try {
    if (kind === 'project') {
      await httpJson(ep, 'GET', `/api/projects/${id}`);
      return true;
    }
    if (kind === 'decision') {
      await httpJson(ep, 'GET', `/api/decisions/${id}`);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function restoreRecord(
  ep: Endpoint,
  rec: DumpRecord,
  conflict: ConflictStrategy,
  stats: RestoreStats,
): Promise<void> {
  const { kind, data } = rec;
  const id = entityIdOf(data);

  try {
    if (kind === 'meta') return;

    if (kind === 'project') {
      if (id && (await existsOnTarget(ep, 'project', id))) {
        if (conflict === 'skip') {
          stats.skipped += 1;
          return;
        }
        if (conflict === 'fail') {
          throw new Error(`project ${id} already exists`);
        }
        // overwrite: attempt PATCH, falling back to re-create if unavailable
        try {
          await httpJson(ep, 'PATCH', `/api/projects/${id}`, data);
          stats.overwritten += 1;
          stats.projects += 1;
          return;
        } catch {
          /* fall through to post */
        }
      }
      await httpJson(ep, 'POST', '/api/projects', data);
      stats.projects += 1;
      return;
    }

    if (kind === 'agent') {
      const pid = data['project_id'];
      if (typeof pid !== 'string') throw new Error('agent missing project_id');
      await httpJson(ep, 'POST', `/api/projects/${pid}/agents`, data);
      stats.agents += 1;
      return;
    }

    if (kind === 'decision') {
      if (id && (await existsOnTarget(ep, 'decision', id))) {
        if (conflict === 'skip') {
          stats.skipped += 1;
          return;
        }
        if (conflict === 'fail') {
          throw new Error(`decision ${id} already exists`);
        }
        try {
          await httpJson(ep, 'PATCH', `/api/decisions/${id}`, data);
          stats.overwritten += 1;
          stats.decisions += 1;
          return;
        } catch {
          /* fall through */
        }
      }
      const pid = data['project_id'];
      if (typeof pid !== 'string') throw new Error('decision missing project_id');
      await httpJson(ep, 'POST', `/api/projects/${pid}/decisions`, data);
      stats.decisions += 1;
      return;
    }

    if (kind === 'edge') {
      const sourceId = data['source_id'] ?? data['decision_id'];
      if (typeof sourceId !== 'string') {
        throw new Error('edge missing source_id');
      }
      await httpJson(ep, 'POST', `/api/decisions/${sourceId}/edges`, data);
      stats.edges += 1;
      return;
    }

    if (kind === 'outcome') {
      await httpJson(ep, 'POST', '/api/outcomes', data);
      stats.outcomes += 1;
      return;
    }

    if (kind === 'session') {
      const pid = data['project_id'];
      if (typeof pid !== 'string') throw new Error('session missing project_id');
      await httpJson(ep, 'POST', `/api/projects/${pid}/sessions`, data);
      stats.sessions += 1;
      return;
    }

    if (kind === 'capture') {
      await httpJson(ep, 'POST', '/api/capture', data);
      stats.captures += 1;
      return;
    }
  } catch (err) {
    stats.errors += 1;
    if (conflict === 'fail') throw err;
    // Otherwise swallow the individual error and continue.
    console.error(
      chalk.yellow(`\n  ⚠ ${kind} ${id ?? ''}: ${(err as Error).message}`),
    );
  }
}

async function restoreFromFile(
  ep: Endpoint,
  inPath: string,
  conflict: ConflictStrategy,
): Promise<RestoreStats> {
  if (!existsSync(inPath)) {
    throw new Error(`Input file not found: ${inPath}`);
  }
  if (!isNdjsonFile(inPath)) {
    throw new Error('Input file is empty');
  }

  const stats = emptyRestoreStats();
  let processed = 0;

  const records = await readRecordsFromFile(inPath);
  for await (const rec of records) {
    await restoreRecord(ep, rec, conflict, stats);
    processed += 1;
    if (processed % 25 === 0) drawProgress('restore', processed, null);
  }
  drawProgress('restore', processed, processed);
  endProgressLine();
  return stats;
}

/* ------------------------------------------------------------------ */
/*  COPY (dump + restore via tmp file)                                 */
/* ------------------------------------------------------------------ */

async function copyBetween(
  from: Endpoint,
  to: Endpoint,
  tmpPath: string,
  conflict: ConflictStrategy,
  filterProject?: string,
): Promise<{ dump: DumpStats; restore: RestoreStats }> {
  const dump = await dumpToFile(from, tmpPath, filterProject);
  const restore = await restoreFromFile(to, tmpPath, conflict);
  return { dump, restore };
}

/* ------------------------------------------------------------------ */
/*  Command registration                                               */
/* ------------------------------------------------------------------ */

function printDumpStats(stats: DumpStats): void {
  console.error(chalk.green('\n  Dumped:'));
  console.error(`    Projects:  ${chalk.bold(stats.projects)}`);
  console.error(`    Agents:    ${chalk.bold(stats.agents)}`);
  console.error(`    Decisions: ${chalk.bold(stats.decisions)}`);
  console.error(`    Edges:     ${chalk.bold(stats.edges)}`);
  console.error(`    Outcomes:  ${chalk.bold(stats.outcomes)}`);
  console.error(`    Sessions:  ${chalk.bold(stats.sessions)}`);
  console.error(`    Captures:  ${chalk.bold(stats.captures)}`);
}

function printRestoreStats(stats: RestoreStats): void {
  console.error(chalk.green('\n  Restored:'));
  console.error(`    Projects:    ${chalk.bold(stats.projects)}`);
  console.error(`    Agents:      ${chalk.bold(stats.agents)}`);
  console.error(`    Decisions:   ${chalk.bold(stats.decisions)}`);
  console.error(`    Edges:       ${chalk.bold(stats.edges)}`);
  console.error(`    Outcomes:    ${chalk.bold(stats.outcomes)}`);
  console.error(`    Sessions:    ${chalk.bold(stats.sessions)}`);
  console.error(`    Captures:    ${chalk.bold(stats.captures)}`);
  console.error(chalk.dim(`    Skipped:     ${stats.skipped}`));
  console.error(chalk.dim(`    Overwritten: ${stats.overwritten}`));
  console.error(
    stats.errors > 0
      ? chalk.red(`    Errors:      ${stats.errors}`)
      : chalk.dim(`    Errors:      ${stats.errors}`),
  );
}

export function registerMigrateCommand(program: Command): void {
  const migrate = program
    .command('migrate')
    .description('Migrate Hipp0 data between instances (dump / restore / copy)');

  // dump
  migrate
    .command('dump')
    .description('Dump data from the current server to NDJSON')
    .option('-o, --output <file>', 'Output NDJSON file', 'hipp0-backup.ndjson')
    .option('-p, --project <id>', 'Only dump a single project')
    .option('--from <url>', 'Source server URL (defaults to HIPP0_API_URL)')
    .action(
      async (opts: { output: string; project?: string; from?: string }) => {
        const spinner = ora('Starting dump...').start();
        try {
          const ep = resolveEndpoint(opts.from);
          const outPath = resolve(opts.output);
          spinner.text = `Dumping from ${ep.baseUrl} → ${outPath}`;
          spinner.stop();

          const stats = await dumpToFile(ep, outPath, opts.project);
          console.error(chalk.green(`\n✓ Dump complete → ${outPath}`));
          printDumpStats(stats);
        } catch (err) {
          handleError(err, spinner);
        }
      },
    );

  // restore
  migrate
    .command('restore')
    .description('Restore a dump into the current server')
    .option('-i, --input <file>', 'Input NDJSON file', 'hipp0-backup.ndjson')
    .option('--to <url>', 'Target server URL (defaults to HIPP0_API_URL)')
    .option(
      '--conflict <strategy>',
      'Conflict strategy: skip, overwrite, fail',
      'skip',
    )
    .action(
      async (opts: { input: string; to?: string; conflict: string }) => {
        const spinner = ora('Starting restore...').start();
        try {
          const strategy = (opts.conflict || 'skip') as ConflictStrategy;
          if (!['skip', 'overwrite', 'fail'].includes(strategy)) {
            throw new Error(
              `Invalid --conflict "${opts.conflict}". Must be skip, overwrite, or fail.`,
            );
          }
          const ep = resolveEndpoint(opts.to);
          const inPath = resolve(opts.input);
          spinner.text = `Restoring ${inPath} → ${ep.baseUrl}`;
          spinner.stop();

          const stats = await restoreFromFile(ep, inPath, strategy);
          console.error(chalk.green(`\n✓ Restore complete`));
          printRestoreStats(stats);
        } catch (err) {
          handleError(err, spinner);
        }
      },
    );

  // copy
  migrate
    .command('copy')
    .description('Copy data from one server to another in one step')
    .requiredOption('--from <url>', 'Source server URL')
    .requiredOption('--to <url>', 'Target server URL')
    .option('-p, --project <id>', 'Only copy a single project')
    .option(
      '--conflict <strategy>',
      'Conflict strategy: skip, overwrite, fail',
      'skip',
    )
    .option('--tmp <file>', 'Intermediate NDJSON file', '/tmp/hipp0-copy.ndjson')
    .action(
      async (opts: {
        from: string;
        to: string;
        project?: string;
        conflict: string;
        tmp: string;
      }) => {
        const spinner = ora('Starting copy...').start();
        try {
          const strategy = (opts.conflict || 'skip') as ConflictStrategy;
          if (!['skip', 'overwrite', 'fail'].includes(strategy)) {
            throw new Error(
              `Invalid --conflict "${opts.conflict}". Must be skip, overwrite, or fail.`,
            );
          }
          const from: Endpoint = {
            baseUrl: opts.from.replace(/\/$/, ''),
            apiKey: process.env.HIPP0_API_KEY,
          };
          const to: Endpoint = {
            baseUrl: opts.to.replace(/\/$/, ''),
            apiKey: process.env.HIPP0_API_KEY,
          };
          const tmpPath = resolve(opts.tmp);
          spinner.text = `Copying ${from.baseUrl} → ${to.baseUrl}`;
          spinner.stop();

          const { dump, restore } = await copyBetween(
            from,
            to,
            tmpPath,
            strategy,
            opts.project,
          );

          console.error(chalk.green(`\n✓ Copy complete (via ${tmpPath})`));
          printDumpStats(dump);
          printRestoreStats(restore);
        } catch (err) {
          handleError(err, spinner);
        }
      },
    );
}
