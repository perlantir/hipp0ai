/**
 * PostgresAdapter
 *
 * Wraps the existing pg Pool from pool.ts and implements DatabaseAdapter.
 * Placeholder style for callers is `?`; we translate to `$1`, `$2`, … before
 * handing the query to pg.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getPool } from './pool.js';
import type { DatabaseAdapter, QueryResult, TransactionQueryFn } from './adapter.js';
import type { DatabaseConfig } from './factory.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Placeholder translation
// ---------------------------------------------------------------------------

/**
 * Convert `?` positional placeholders to pg-style `$1`, `$2`, … placeholders.
 * Handles quoted string literals and SQL comments conservatively by only
 * replacing bare `?` characters that appear outside of single-quoted strings.
 */
function translatePlaceholders(sql: string): string {
  if (!sql) return '';
  let idx = 0;
  let inString = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;

    if (inString) {
      result += ch;
      if (ch === "'") {
        // Handle escaped quote ('') inside string literals
        if (sql[i + 1] === "'") {
          result += sql[++i]!;
        } else {
          inString = false;
        }
      }
    } else {
      if (ch === "'") {
        inString = true;
        result += ch;
      } else if (ch === '?') {
        result += `$${++idx}`;
      } else {
        result += ch;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// PostgresAdapter
// ---------------------------------------------------------------------------

export class PostgresAdapter implements DatabaseAdapter {
  readonly dialect = 'postgres' as const;

  private _pool: pg.Pool | null = null;
  private readonly _config: DatabaseConfig | undefined;

  // Request-scoped tenant context used to drive PostgreSQL RLS policies.
  // Because pg Pool does not give us a persistent per-request client, we
  // snapshot these values on the adapter instance right before a query and
  // inject them via `SET LOCAL` at the top of each transaction. For
  // stand-alone queries (outside a transaction) we start a short implicit
  // transaction when a tenant context is active so the SET LOCAL is honored
  // and auto-released on COMMIT.
  private _currentProjectId: string | null = null;
  private _rlsBypass: boolean = false;

  constructor(config?: DatabaseConfig) {
    this._config = config ?? {};
    // Ensure connectionString falls back to env
    if (!this._config.connectionString && process.env.DATABASE_URL) {
      this._config.connectionString = process.env.DATABASE_URL;
    }
  }

  // ---- tenant context (RLS) ----------------------------------------------

  /**
   * Set the tenant context for subsequent queries on this adapter. The
   * `projectId` is injected into each transaction as `app.current_project_id`
   * which tenant RLS policies read via `current_setting()`.
   *
   * Passing `null` clears the context — queries that run without a tenant
   * context will then see an empty result set for all RLS-protected tables
   * (fail-closed), which is the desired safety posture.
   */
  setProjectContext(projectId: string | null): void {
    this._currentProjectId = projectId;
  }

  /**
   * Elevated mode for admin operations (migrations, background workers,
   * cross-tenant analytics). Sets `app.bypass_rls=true` on subsequent
   * transactions so RLS policies permit all rows.
   *
   * Always pair with a matching `disableRlsBypass()` call once the elevated
   * section is complete; leaving bypass enabled is equivalent to disabling
   * the RLS safety net entirely.
   */
  enableRlsBypass(): void {
    this._rlsBypass = true;
  }

  disableRlsBypass(): void {
    this._rlsBypass = false;
  }

  getProjectContext(): string | null {
    return this._currentProjectId;
  }

  // ---- connect / close ----------------------------------------------------

  async connect(): Promise<void> {
    // Initialise (or reuse) the pool and verify connectivity.
    try {
      this._pool = this._buildPool();
    } catch (err) {
      const connStr = this._config?.connectionString ?? process.env.DATABASE_URL ?? '<not set>';
      throw new Error(
        `[hipp0/postgres] Failed to create connection pool. ` +
        `DATABASE_URL=${connStr.replace(/:[^:@]+@/, ':***@')}. ` +
        `Original error: ${(err as Error).message}`,
      );
    }
    const ok = await this.healthCheck();
    if (!ok) {
      const connStr = this._config?.connectionString ?? process.env.DATABASE_URL ?? '<not set>';
      throw new Error(
        `[hipp0/postgres] Database health check failed on connect. ` +
        `DATABASE_URL=${connStr.replace(/:[^:@]+@/, ':***@')}`,
      );
    }
  }

  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }

  // ---- health check -------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this._rawQuery<{ ok: number }>('SELECT 1 AS ok', []);
      return (result.rows ?? [])[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  // ---- query --------------------------------------------------------------

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const translated = translatePlaceholders(sql);

    // If a tenant context or RLS bypass is active, we must route the query
    // through a short transaction so that `SET LOCAL` applies and is
    // auto-released on COMMIT. For plain queries without a context, we can
    // skip the round trip and use a single pool.query.
    if (this._currentProjectId !== null || this._rlsBypass) {
      const pool = this._getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await this._applyRlsContext(client);
        const result = await client.query<T & pg.QueryResultRow>(
          translated,
          (params ?? []) as unknown[],
        );
        await client.query('COMMIT');
        return {
          rows: result.rows ?? [],
          rowCount: result.rowCount ?? (result.rows?.length ?? 0),
        };
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      } finally {
        client.release();
      }
    }

    return this._rawQuery<T>(translated, params ?? []);
  }

  // ---- transaction --------------------------------------------------------

  async transaction<T>(
    fn: (query: TransactionQueryFn) => Promise<T>,
  ): Promise<T> {
    const pool = this._getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this._applyRlsContext(client);

      const txQuery: TransactionQueryFn = async (sql, params) => {
        const translated = translatePlaceholders(sql);
        const result = await client.query<Record<string, unknown>>(
          translated,
          params as unknown[] | undefined,
        );
        return {
          rows: result.rows ?? [],
          rowCount: result.rowCount ?? (result.rows?.length ?? 0),
        };
      };

      const value = await fn(txQuery);
      await client.query('COMMIT');
      return value;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Inject the current tenant context into an open transaction.  Uses
   * `SET LOCAL` so the settings revert at COMMIT / ROLLBACK automatically.
   * Silently swallows errors so that deployments without the RLS migration
   * still work — RLS is purely additive.
   */
  private async _applyRlsContext(client: pg.PoolClient): Promise<void> {
    try {
      if (this._currentProjectId) {
        // Use set_config() which accepts a value parameter safely.
        await client.query(
          "SELECT set_config('app.current_project_id', $1, true)",
          [this._currentProjectId],
        );
      }
      if (this._rlsBypass) {
        await client.query(
          "SELECT set_config('app.bypass_rls', 'true', true)",
        );
      }
    } catch (err) {
      // Never let RLS context errors break queries. Log once per occurrence.
      console.warn(
        '[hipp0/postgres] Failed to apply RLS context:',
        (err as Error).message,
      );
    }
  }

  // ---- vectorSearch -------------------------------------------------------

  private static readonly ALLOWED_TABLES = new Set(['decisions', 'sessions', 'agents']);
  private static readonly ALLOWED_COLUMNS = new Set(['embedding', 'id', 'title', 'project_id', 'status']);

  async vectorSearch(
    table: string,
    embeddingColumn: string,
    queryVector: number[],
    limit: number,
    filters?: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (!PostgresAdapter.ALLOWED_TABLES.has(table)) {
      throw new Error('Invalid table');
    }
    if (!PostgresAdapter.ALLOWED_COLUMNS.has(embeddingColumn)) {
      throw new Error('Invalid column');
    }

    const conditions: string[] = [`${embeddingColumn} IS NOT NULL`];
    const params: unknown[] = [JSON.stringify(queryVector), limit];
    let paramIdx = 3;

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (!PostgresAdapter.ALLOWED_COLUMNS.has(key)) {
          throw new Error('Invalid column');
        }
        conditions.push(`${key} = $${paramIdx++}`);
        params.push(value);
      }
    }

    const where = conditions.join(' AND ');
    const sql = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${embeddingColumn} <=> $1::vector LIMIT $2`;

    return this._rawQuery(sql, params);
  }

  // ---- runMigrations ------------------------------------------------------

  async runMigrations(migrationsDir: string): Promise<void> {
    // Migrations need cross-tenant access (CREATE TABLE, ALTER TABLE, etc.)
    // so they always run with the RLS bypass enabled. The bypass is scoped
    // to the SET LOCAL inside each migration transaction.
    const previousBypass = this._rlsBypass;
    this._rlsBypass = true;

    try {
      await this._runMigrationsInner(migrationsDir);
    } finally {
      this._rlsBypass = previousBypass;
    }
  }

  private async _runMigrationsInner(migrationsDir: string): Promise<void> {
    // Ensure tracking table exists (PostgreSQL dialect).
    await this.query(`
      CREATE TABLE IF NOT EXISTS _hipp0_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await this.query<{ name: string }>(
      'SELECT name FROM _hipp0_migrations ORDER BY id',
    );
    const appliedSet = new Set((applied.rows ?? []).map((r) => r.name));

    let files: string[];
    try {
      files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch (err) {
      console.warn(`[hipp0/postgres] Migrations directory not found: ${migrationsDir}. Skipping migrations.`);
      return;
    }

    // Each migration in its OWN transaction
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await this.transaction(async (txQuery) => {
          await txQuery(sql);
          await txQuery('INSERT INTO _hipp0_migrations (name) VALUES (?)', [file]);
        });
        console.warn(`[hipp0/migrations] ✅ Applied ${file}`);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // Tolerate harmless DDL idempotency errors (already exists, duplicate column)
        if (msg.includes('already exists') || msg.includes('duplicate key') || msg.includes('duplicate column')) {
          console.warn(`[hipp0/migrations] ⚠️ ${file}: ${msg} (safe to continue)`);
          // Mark as applied so it doesn't retry
          await this.query('INSERT INTO _hipp0_migrations (name) VALUES (?) ON CONFLICT DO NOTHING', [file]);
        } else {
          console.error(`[hipp0/migrations] ❌ ${file} failed: ${msg}`);
          throw new Error(`Migration ${file} failed: ${msg}. Fix the migration and restart.`);
        }
      }
    }
  }

  // ---- arrayParam ---------------------------------------------------------

  arrayParam(values: unknown[]): unknown {
    // PostgreSQL handles native JS arrays natively via the pg driver.
    return values;
  }

  // ---- private helpers ----------------------------------------------------

  private _buildPool(): pg.Pool {
    // Prefer config passed explicitly; fall back to environment variables.
    // This mirrors the logic in pool.ts so that existing callers continue to work.
    const connectionString =
      this._config?.connectionString ?? process.env.DATABASE_URL;

    if (!connectionString) {
      console.warn('[hipp0/postgres] WARNING: No connectionString or DATABASE_URL set. Pool will try default pg settings.');
    }

    const useSSL =
      this._config?.ssl ?? process.env.DATABASE_SSL === 'true';

    const pool = new Pool({
      connectionString,
      min: this._config?.poolMin ?? parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10),
      max: this._config?.poolMax ?? parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...(useSSL && { ssl: { rejectUnauthorized: true } }),
    });

    pool.on('error', (err) => {
      console.error('[hipp0/postgres] Unexpected pool error:', (err as Error).message);
    });

    return pool;
  }

  private _getPool(): pg.Pool {
    if (this._pool) return this._pool;
    // If connect() was never called, fall back to the shared singleton pool
    // from pool.ts for backward compatibility.
    return getPool(this._config);
  }

  private async _rawQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<T>> {
    const pool = this._getPool();
    const result = await pool.query<T & pg.QueryResultRow>(sql, params);
    return {
      rows: result.rows ?? [],
      rowCount: result.rowCount ?? (result.rows?.length ?? 0),
    };
  }
}
