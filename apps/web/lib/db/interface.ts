/**
 * lib/db/interface.ts
 *
 * TypeScript interface that every database adapter must implement.
 * Application code should only depend on this interface, never on a
 * concrete adapter or provider SDK directly.
 */

// ---------------------------------------------------------------------------
// Generic query types
// ---------------------------------------------------------------------------

/** Result of a raw SQL query. */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/** A value that can safely be passed as a SQL parameter. */
export type SqlParam =
  | string
  | number
  | boolean
  | null
  | Date
  | Buffer
  | SqlParam[];

// ---------------------------------------------------------------------------
// Transaction support
// ---------------------------------------------------------------------------

/** Minimal interface exposed inside a transaction callback. */
export interface TransactionClient {
  /**
   * Execute a parameterised SQL query inside the transaction.
   * @param sql  - Parameterised SQL string (use $1, $2 … placeholders)
   * @param params - Ordered parameter values
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[]
  ): Promise<QueryResult<T>>;
}

// ---------------------------------------------------------------------------
// Main adapter interface
// ---------------------------------------------------------------------------

/**
 * All database adapters must implement this interface.
 * This keeps the rest of the application decoupled from the underlying driver.
 */
export interface DatabaseAdapter {
  /**
   * Execute a parameterised SQL query.
   * @param sql    - Parameterised SQL string
   * @param params - Ordered parameter values
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[]
  ): Promise<QueryResult<T>>;

  /**
   * Execute multiple queries inside a single ACID transaction.
   * The callback receives a {@link TransactionClient} with a scoped `query`.
   * If the callback throws the transaction is rolled back automatically.
   *
   * @param fn - Async function that performs queries within the transaction
   */
  transaction<T>(fn: (client: TransactionClient) => Promise<T>): Promise<T>;

  /**
   * Verify that the adapter can reach the database.
   * Resolves `true` if healthy, rejects or resolves `false` on failure.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Release all connections and clean up resources.
   * Should be called on process exit.
   */
  close(): Promise<void>;
}
