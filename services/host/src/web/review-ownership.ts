import type { SqlExecutor } from "../../../../packages/evidence-store/src/index.js";

/**
 * Which tenant a review belongs to. A grant names a tenant and, optionally, a
 * review; a tenant-wide grant covers only the tenant's own reviews. Without
 * this the access gate could only compare the actor's tenant with itself, so
 * a tenant-wide grant reached every review id a caller typed.
 *
 * `public_synthetic` is for the shipped synthetic-demo fixtures that the demo
 * deployment seeds: they are public repository content, so any signed-in
 * account on that deployment may read them. Nothing else is ever public.
 */
export type ReviewOwnership =
  | { kind: "owned"; tenant_id: string }
  | { kind: "public_synthetic" }
  | { kind: "unknown" };

export type ReviewOwnershipReader = (reviewId: string) => Promise<ReviewOwnership>;

export type SeedableReviewOwnershipReader = ReviewOwnershipReader & {
  seedOwner(reviewId: string, tenantId: string): void;
  seedPublicSynthetic(reviewId: string): void;
};

export function createMemoryReviewOwnershipReader(): SeedableReviewOwnershipReader {
  const owners = new Map<string, string>();
  const publicSynthetic = new Set<string>();
  const reader = (async (reviewId: string): Promise<ReviewOwnership> => {
    const owner = owners.get(reviewId);
    if (owner !== undefined) {
      return { kind: "owned", tenant_id: owner };
    }
    return publicSynthetic.has(reviewId) ? { kind: "public_synthetic" } : { kind: "unknown" };
  }) as SeedableReviewOwnershipReader;
  reader.seedOwner = (reviewId, tenantId) => {
    owners.set(reviewId, tenantId);
  };
  reader.seedPublicSynthetic = (reviewId) => {
    publicSynthetic.add(reviewId);
  };
  return reader;
}

/**
 * Reads ownership from the operator-provisioned submission credentials: each
 * credential binds one review to one tenant. A review with credentials for
 * more than one tenant is an operator error and is treated as unknown, so it
 * fails closed for everyone instead of opening to both tenants.
 */
export function createPostgresReviewOwnershipReader(sql: SqlExecutor, fallback?: ReviewOwnershipReader): ReviewOwnershipReader {
  return async (reviewId) => {
    const { rows } = await sql.query("SELECT DISTINCT tenant_id FROM submission_credential WHERE review_id = $1", [reviewId]);
    if (rows.length === 1) {
      return { kind: "owned", tenant_id: String(rows[0]!.tenant_id) };
    }
    if (rows.length > 1) {
      return { kind: "unknown" };
    }
    return fallback === undefined ? { kind: "unknown" } : fallback(reviewId);
  };
}

/**
 * The tenant to put on an artifact scope for `actor`'s read of `reviewId`, or
 * undefined when the review is unknown. A foreign review returns its real
 * owner, so the scoped-access check denies it as out of scope.
 */
export function ownerTenantFor(ownership: ReviewOwnership, actorTenantId: string): string | undefined {
  if (ownership.kind === "owned") {
    return ownership.tenant_id;
  }
  return ownership.kind === "public_synthetic" ? actorTenantId : undefined;
}
