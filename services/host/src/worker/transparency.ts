import {
  computeCheckpoint,
  computeReviewChainHead,
  publishCheckpoint,
  TransparencyAnchorNotConfiguredError,
  verifyPublishedCheckpoint,
  type ReviewEventLogStore,
  type ReviewHead,
  type SqlExecutor,
  type TransparencyAnchor,
  type TransparencyCheckpointRecord
} from "../../../../packages/evidence-store/src/index.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The deployment's adapter for the `TransparencyAnchor` port: an HTTPS object
 * endpoint with a bearer token. A checkpoint is written with
 * `PUT <base_url>/checkpoints/<checkpoint_id>` and read back with GET on the
 * same URL. The anchor ref is the `anchor_ref` the endpoint returns, or the
 * URL itself.
 */
export function createHttpTransparencyAnchor(input: { baseUrl: string; token: string; fetchImpl?: FetchLike }): TransparencyAnchor {
  const fetchImpl = input.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const urlFor = (checkpointId: string) => `${input.baseUrl}/checkpoints/${encodeURIComponent(checkpointId)}`;
  const authorization = `Bearer ${input.token}`;
  return {
    async put(record) {
      const url = urlFor(record.checkpoint_id);
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(record),
        // The request carries the bearer token; never follow it elsewhere.
        redirect: "error"
      });
      if (!response.ok) {
        throw new Error(`transparency anchor refused the checkpoint: HTTP ${response.status}`);
      }
      const text = await response.text();
      let anchorRef = url;
      try {
        const parsed = text.length === 0 ? undefined : (JSON.parse(text) as { anchor_ref?: unknown });
        if (typeof parsed?.anchor_ref === "string" && parsed.anchor_ref.length > 0) {
          anchorRef = parsed.anchor_ref;
        }
      } catch {
        // A non-JSON body is fine; the URL is the reference.
      }
      return { anchor_ref: anchorRef };
    },
    async get(checkpointId) {
      const response = await fetchImpl(urlFor(checkpointId), { method: "GET", headers: { authorization }, redirect: "error" });
      if (response.status === 404) {
        return undefined;
      }
      if (!response.ok) {
        throw new Error(`transparency anchor read failed: HTTP ${response.status}`);
      }
      const parsed = (await response.json()) as Partial<TransparencyCheckpointRecord>;
      if (
        typeof parsed.checkpoint_id !== "string" ||
        typeof parsed.merkle_root !== "string" ||
        typeof parsed.tree_size !== "number" ||
        typeof parsed.published_at !== "string"
      ) {
        throw new Error("transparency anchor returned a malformed checkpoint record");
      }
      return {
        checkpoint_id: parsed.checkpoint_id,
        merkle_root: parsed.merkle_root,
        tree_size: parsed.tree_size,
        published_at: parsed.published_at
      };
    }
  };
}

export type CoveredReviewHead = ReviewHead & { head_event_id: string };

export type CheckpointPublication = TransparencyCheckpointRecord & { anchor_ref: string };

/** Append-only record of checkpoints published and read back (migration 0007). */
export interface CheckpointPublicationStore {
  latest(): Promise<CheckpointPublication | undefined>;
  record(publication: CheckpointPublication, heads: readonly CoveredReviewHead[]): Promise<void>;
}

export function createMemoryCheckpointPublicationStore(): CheckpointPublicationStore & { published: CheckpointPublication[] } {
  const published: CheckpointPublication[] = [];
  return {
    published,
    async latest() {
      return published.at(-1);
    },
    async record(publication) {
      published.push(publication);
    }
  };
}

export function createPostgresCheckpointPublicationStore(sql: SqlExecutor): CheckpointPublicationStore {
  return {
    async latest() {
      const { rows } = await sql.query(
        `SELECT checkpoint_id, merkle_root, tree_size, published_at, anchor_ref
           FROM transparency_checkpoint_publication
          ORDER BY recorded_at DESC, checkpoint_id DESC LIMIT 1`
      );
      const row = rows[0];
      return row === undefined
        ? undefined
        : {
            checkpoint_id: String(row.checkpoint_id),
            merkle_root: String(row.merkle_root),
            tree_size: Number(row.tree_size),
            published_at: String(row.published_at),
            anchor_ref: String(row.anchor_ref)
          };
    },
    async record(publication, heads) {
      await sql.query(
        `INSERT INTO transparency_checkpoint_publication (checkpoint_id, merkle_root, tree_size, published_at, anchor_ref)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (checkpoint_id) DO NOTHING`,
        [publication.checkpoint_id, publication.merkle_root, publication.tree_size, publication.published_at, publication.anchor_ref]
      );
      for (const head of heads) {
        await sql.query(
          "INSERT INTO chain_head_anchor (review_id, head_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [head.review_id, head.head_event_id]
        );
      }
    }
  };
}

/** Every review's chain head, from the append-only review-event log. */
export async function loadReviewHeads(sql: SqlExecutor, reviewEventLog: ReviewEventLogStore): Promise<CoveredReviewHead[]> {
  const { rows } = await sql.query("SELECT DISTINCT review_id FROM review_event ORDER BY review_id");
  const heads: CoveredReviewHead[] = [];
  for (const row of rows) {
    const reviewId = String(row.review_id);
    const events = await reviewEventLog.loadLog(reviewId);
    const last = [...events].sort((left, right) => left.sequence_number - right.sequence_number).at(-1);
    if (last !== undefined) {
      heads.push({ review_id: reviewId, head_hash: computeReviewChainHead(events), head_event_id: last.event_id });
    }
  }
  return heads;
}

export type CheckpointRunResult =
  | { outcome: "published"; checkpoint_id: string; anchor_ref: string; tree_size: number }
  | { outcome: "unchanged"; checkpoint_id: string; tree_size: number };

/**
 * One checkpoint run. Without an anchor it throws (fails closed); it never
 * reports a publication it could not read back. When the review heads have
 * not changed since the last publication, it re-reads that publication from
 * the anchor instead of publishing a duplicate, so a changed or lost anchor
 * record is still caught on every run.
 */
export async function runTransparencyCheckpoint(input: {
  anchor: TransparencyAnchor | undefined;
  heads: readonly CoveredReviewHead[];
  publications: CheckpointPublicationStore;
  now: () => string;
}): Promise<CheckpointRunResult> {
  if (input.anchor === undefined) {
    throw new TransparencyAnchorNotConfiguredError();
  }
  const checkpoint = computeCheckpoint(input.heads);
  const latest = await input.publications.latest();
  if (latest !== undefined && latest.merkle_root === checkpoint.merkle_root && latest.tree_size === checkpoint.tree_size) {
    const check = await verifyPublishedCheckpoint({ anchor: input.anchor, expected: latest });
    if (!check.verified) {
      throw new Error(`the last published checkpoint ${latest.checkpoint_id} no longer verifies at the anchor: ${check.reason}`);
    }
    return { outcome: "unchanged", checkpoint_id: latest.checkpoint_id, tree_size: latest.tree_size };
  }

  const published = await publishCheckpoint({ anchor: input.anchor, checkpoint, publishedAt: input.now() });
  const check = await verifyPublishedCheckpoint({ anchor: input.anchor, expected: published.record });
  if (!check.verified) {
    throw new Error(`checkpoint ${published.checkpoint_id} did not read back from the anchor: ${check.reason}`);
  }
  await input.publications.record({ ...published.record, anchor_ref: published.anchor_ref }, input.heads);
  return { outcome: "published", checkpoint_id: published.checkpoint_id, anchor_ref: published.anchor_ref, tree_size: checkpoint.tree_size };
}
