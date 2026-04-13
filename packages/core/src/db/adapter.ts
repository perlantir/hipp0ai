/**
 * DatabaseAdapter — dialect-agnostic interface for all Hipp0 DB access.
 *
 * Both PostgresAdapter and SQLiteAdapter implement this interface so that
 * higher-level code is completely decoupled from the underlying driver.
 */

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/**
 * A query function scoped to a transaction.  Passed as the sole argument to
 * the callback supplied to `DatabaseAdapter.transaction()`.
 */
export type TransactionQueryFn = (
  sql: string,
  params?: unknown[],
) => Promise<QueryResult>;

export interface DatabaseAdapter {
  /**
   * Execute a SQL statement and return the rows (SELECT) or affected row
   * count (INSERT / UPDATE / DELETE).
   *
   * Placeholder style: use `?` for both dialects — the adapter translates
   * to `$1`, `$2`, … when talking to PostgreSQL.
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;

  /**
   * Execute multiple statements inside a single database transaction.
   * The `fn` callback receives a query helper already bound to the open
   * transaction; commit on success, rollback on any thrown error.
   */
  transaction<T>(
    fn: (query: TransactionQueryFn) => Promise<T>,
  ): Promise<T>;

  /**
   * Initialise the connection / open the database file.
   * Must be called once before any queries are issued.
   */
  connect(): Promise<void>;

  /**
   * Gracefully tear down connections / close the database file.
   */
  close(): Promise<void>;

  /**
   * Return `true` when the database is reachable and accepting queries.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Perform an ANN vector similarity search.
   *
   * - PostgreSQL: uses the pgvector `<=>` cosine-distance operator.
   * - SQLite:     uses the sqlite-vec extension (vec0 virtual table);
   *               gracefully returns empty rows when the extension is absent.
   *
   * @param table           Base table name (e.g. `"decisions"`).
   * @param embeddingColumn Column that holds the embedding (e.g. `"embedding"`).
   * @param queryVector     The query embedding as a plain number array.
   * @param limit           Maximum number of results to return.
   * @param filters         Optional equality filters applied as WHERE clauses.
   */
  vectorSearch(
    table: string,
    embeddingColumn: string,
    queryVector: number[],
    limit: number,
    filters?: Record<string, unknown>,
  ): Promise<QueryResult>;

  /**
   * Apply pending SQL migration files from `migrationsDir` in lexicographic
   * order, skipping files already recorded in `_hipp0_migrations`.
   */
  runMigrations(migrationsDir: string): Promise<void>;

  /**
   * Serialise an array value to the form expected by the current dialect.
   *
   * - PostgreSQL: returns the array as-is (native array support).
   * - SQLite:     returns `JSON.stringify(values)` (stored as TEXT).
   */
  arrayParam(values: unknown[]): unknown;

  /**
   * Set the tenant context for subsequent queries. Postgres uses this to
   * inject `app.current_project_id` into each transaction so RLS policies
   * can scope rows to the right project. SQLite is a no-op (does not
   * support RLS).
   */
  setProjectContext?(projectId: string | null): void;

  /**
   * Enable the admin / cross-tenant bypass (Postgres only). SQLite is a
   * no-op. Always pair with `disableRlsBypass()` when the elevated section
   * completes.
   */
  enableRlsBypass?(): void;

  /**
   * Disable the admin / cross-tenant bypass (Postgres only).
   */
  disableRlsBypass?(): void;

  /**
   * Read the current tenant context (Postgres only).
   */
  getProjectContext?(): string | null;

  /**
   * The SQL dialect in use.  Useful for dialect-specific code paths in
   * higher-level modules.
   */
  readonly dialect: 'sqlite' | 'postgres';
}
