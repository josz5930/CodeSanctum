import type { JobQueue, JobRecord } from "../ports.js";

type JobRow = JobRecord & { claimed: boolean };

export function createMemoryJobQueue(): JobQueue {
  const jobs = new Map<string, JobRow>();

  return {
    async enqueue(input: { job_id: string; job_type: string; payload: string }) {
      if (jobs.has(input.job_id)) {
        return { outcome: "already_present" as const };
      }
      jobs.set(input.job_id, { ...input, attempts: 0, claimed: false });
      return { outcome: "enqueued" as const };
    },

    async claim(jobType: string): Promise<JobRecord | undefined> {
      for (const job of jobs.values()) {
        if (job.job_type === jobType && !job.claimed) {
          job.claimed = true;
          job.attempts += 1;
          return { job_id: job.job_id, job_type: job.job_type, payload: job.payload, attempts: job.attempts };
        }
      }
      return undefined;
    },

    async complete(jobId: string) {
      jobs.delete(jobId);
    },

    /** A failed job returns to the queue; its attempt count is already raised. */
    async fail(jobId: string) {
      const job = jobs.get(jobId);
      if (job !== undefined) {
        job.claimed = false;
      }
    }
  };
}
