import type { JobQueue, JobRecord } from "../ports.js";
import type { SqlExecutor } from "./pool.js";

/**
 * Postgres is the queue as well as the database. `FOR UPDATE SKIP LOCKED` lets
 * several workers claim distinct jobs concurrently without blocking each other,
 * and NOTIFY wakes idle workers so they do not have to poll aggressively.
 */
export function createPostgresJobQueue(sql: SqlExecutor): JobQueue {
  return {
    async enqueue(input: { job_id: string; job_type: string; payload: string }) {
      const result = await sql.query(
        `INSERT INTO job (job_id, job_type, payload) VALUES ($1, $2, $3)
         ON CONFLICT (job_id) DO NOTHING
         RETURNING job_id`,
        [input.job_id, input.job_type, input.payload]
      );
      if (result.rows.length === 0) {
        return { outcome: "already_present" as const };
      }
      await sql.query("SELECT pg_notify('codeattest_job', $1)", [input.job_type]);
      return { outcome: "enqueued" as const };
    },

    async claim(jobType: string): Promise<JobRecord | undefined> {
      const { rows } = await sql.query(
        `UPDATE job SET claimed_at = now(), attempts = attempts + 1
         WHERE job_id = (
           SELECT job_id FROM job
           WHERE job_type = $1 AND claimed_at IS NULL
           ORDER BY enqueued_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING job_id, job_type, payload, attempts`,
        [jobType]
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      return {
        job_id: row.job_id as string,
        job_type: row.job_type as string,
        payload: row.payload as string,
        attempts: Number(row.attempts)
      };
    },

    async complete(jobId: string) {
      await sql.query("DELETE FROM job WHERE job_id = $1", [jobId]);
    },

    /** Returns the job to the queue; its attempt count was raised at claim time. */
    async fail(jobId: string) {
      await sql.query("UPDATE job SET claimed_at = NULL WHERE job_id = $1", [jobId]);
    }
  };
}
