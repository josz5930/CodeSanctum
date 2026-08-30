/**
 * A cheap, TTL-cached live database readiness probe (C2). `/readyz` must report
 * 503 when Postgres is unreachable after boot — not only on SIGTERM — so an
 * upstream stops routing traffic into a host that cannot serve. A raw `SELECT 1`
 * on every probe would let a readiness poller hammer the database, so results
 * are cached for a short TTL and the query itself is bounded by a timeout: a
 * hung backend reports not-ready rather than blocking the health endpoint.
 */

/** The minimal query surface this probe needs (matches evidence-store's SqlExecutor). */
export type ReadinessSql = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type DatabaseReadinessOptions = {
  sql: ReadinessSql;
  /** Abandon the probe query after this many ms and report not-ready. Default 2000. */
  timeoutMs?: number;
  /** Serve the cached result for this many ms before re-probing. Default 1000. */
  ttlMs?: number;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
};

export type DatabaseReadiness = {
  isLive(): Promise<boolean>;
};

export function createDatabaseReadiness(options: DatabaseReadinessOptions): DatabaseReadiness {
  const timeoutMs = options.timeoutMs ?? 2000;
  const ttlMs = options.ttlMs ?? 1000;
  const now = options.now ?? (() => Date.now());

  let cached: boolean | undefined;
  let checkedAt = -Infinity;
  // Collapse concurrent probes (a burst of readiness polls) onto one query.
  let inFlight: Promise<boolean> | undefined;

  async function probeOnce(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Not unref'd: the timeout must be able to fire even when the probe query
    // is the only pending work, and it is always cleared in `finally` below so
    // a fast query leaves no lingering timer.
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      const query = options.sql.query("SELECT 1").then(() => true, () => false);
      return await Promise.race([query, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return {
    async isLive(): Promise<boolean> {
      const current = now();
      if (cached !== undefined && current - checkedAt < ttlMs) {
        return cached;
      }
      if (inFlight !== undefined) {
        return inFlight;
      }
      inFlight = (async () => {
        const live = await probeOnce();
        cached = live;
        checkedAt = now();
        return live;
      })();
      try {
        return await inFlight;
      } finally {
        inFlight = undefined;
      }
    }
  };
}
