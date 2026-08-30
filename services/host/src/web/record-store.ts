/**
 * Read-only per-review record source for E's projection routes. The host owns
 * no writer for these Epic-5 records; in synthetic_demo they are seeded from
 * the shipped protocol fixtures (see E's owner decision). Values are `unknown`
 * on purpose — every projection revalidates through its `@onevps/ui` builder,
 * which fail-closes to an "unavailable" view rather than trusting the store.
 */
export type ReviewRecordSet = {
  vendorReceipt?: unknown;
  findingRecords?: readonly unknown[];
  verificationPassScope?: unknown;
  attestation?: unknown;
  attestationFinalization?: unknown;
  staticBundle?: unknown;
  supportingEvidenceMapping?: unknown;
};

export type ReviewRecordStore = {
  get(reviewScope: string): Promise<ReviewRecordSet | undefined>;
};

export type SeedableReviewRecordStore = ReviewRecordStore & {
  seed(reviewScope: string, records: ReviewRecordSet): void;
};

export function createMemoryReviewRecordStore(): SeedableReviewRecordStore {
  const byScope = new Map<string, ReviewRecordSet>();
  return {
    async get(reviewScope: string): Promise<ReviewRecordSet | undefined> {
      return byScope.get(reviewScope);
    },
    seed(reviewScope: string, records: ReviewRecordSet): void {
      byScope.set(reviewScope, records);
    }
  };
}
