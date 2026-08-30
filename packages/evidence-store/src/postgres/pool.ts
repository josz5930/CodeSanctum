// @ts-expect-error pg does not provide TypeScript definitions
import pg from "pg";

/**
 * The narrow slice of `pg`'s Pool and Client that adapters use. Declaring it
 * structurally keeps the adapters testable with a fake and keeps `pg` types out
 * of the port definitions.
 */
export type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type PostgresPool = SqlExecutor & {
  end(): Promise<void>;
  /**
   * `pg.Pool.query()` acquires a fresh connection per call, so a bare pool
   * cannot hold a BEGIN/COMMIT/ROLLBACK session across calls. Callers that
   * need transactional scope (the boot-time grant self-test) get a client
   * pinned for the duration of `fn` and released afterward either way.
   */
  withConnection<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T>;
};

/**
 * Connection-pool controls and the idle-client error sink. Defaults are
 * conservative and safe for the loopback-only host; an operator can widen
 * `max` or tune the timeouts per deployment without touching this file.
 *
 * TLS: transport security is delegated to the `database_url` `sslmode`
 * (e.g. `sslmode=require`/`verify-full`), which `node-postgres` honors from
 * the connection string. Pass `ssl` here only to override that with an
 * explicit TLS context.
 */
export type PostgresPoolOptions = {
  /** Maximum pooled clients. Default 10 (node-postgres default). */
  max?: number;
  /** Idle client eviction, ms. Default 30_000. */
  idleTimeoutMillis?: number;
  /** Fail a `connect()` that cannot be satisfied in this many ms. Default 10_000. */
  connectionTimeoutMillis?: number;
  /** Explicit TLS context, overriding the `database_url` `sslmode`. */
  ssl?: unknown;
  /**
   * Where the unhandled idle-client `'error'` event is reported. Defaults to
   * `console.error`. It must never rethrow (see below).
   */
  logError?: (message: string, error: unknown) => void;
};

/**
 * The one place outside this package's tests that `pg` is instantiated.
 * `services/host` (and any future consumer) gets a Postgres-backed
 * `SqlExecutor` from here rather than importing `pg` itself, keeping this
 * workspace the sole `pg` dependency in the monorepo.
 *
 * `node-postgres` emits an `'error'` event on **idle** pooled clients when the
 * backend drops a connection (restart, failover, transient network loss). With
 * no listener that event is unhandled and Node terminates the whole process —
 * exactly during the database instability the host most needs to ride out. The
 * listener attached here logs and swallows it; the broken client is evicted by
 * the pool and the next `query()`/`connect()` transparently opens a fresh one.
 */
export function createPostgresPool(databaseUrl: string, options: PostgresPoolOptions = {}): PostgresPool {
  const logError = options.logError ?? ((message, error) => {
    console.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
  const poolConfig: Record<string, unknown> = {
    connectionString: databaseUrl,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000
  };
  if (options.ssl !== undefined) {
    poolConfig.ssl = options.ssl;
  }
  const pool = new pg.Pool(poolConfig);
  // Must not rethrow: this handler exists precisely so an idle-client error
  // does not become an unhandled 'error' event that crashes the process.
  pool.on("error", (error: unknown) => {
    logError("postgres idle client error (recovering)", error);
  });
  return {
    query: (text, values) => pool.query(text, values),
    end: () => pool.end(),
    async withConnection(fn) {
      const client = await pool.connect();
      try {
        return await fn({ query: (text, values) => client.query(text, values) });
      } finally {
        client.release();
      }
    }
  };
}
