import type { EvidenceAccessRole } from "../../../../packages/identity-store/src/index.js";
import {
  CustomerFindingRecordView,
  type CustomerFindingAudience,
  type CustomerFindingRecordViewContract
} from "../../../../packages/ui/src/index.js";
import type { ReviewRecordSet } from "./record-store.js";

/**
 * `evidence_consumer` sees only records the reviewer marked exportable; the
 * `CustomerFindingRecordView` builder enforces that posture and fail-closes to
 * an "unavailable" view for malformed or claim-unsafe records. Audience is
 * derived from the grant's role, never the request.
 */
export function findingAudienceForRole(role: EvidenceAccessRole): CustomerFindingAudience {
  switch (role) {
    case "customer_admin":
    case "customer_viewer":
      return "customer";
    case "codeattest_reviewer":
    case "codeattest_ops":
      return "reviewer";
    case "evidence_consumer_static":
      return "evidence_consumer";
  }
}

export function projectFindingRecords(input: {
  role: EvidenceAccessRole;
  records: ReviewRecordSet | undefined;
}): CustomerFindingRecordViewContract[] {
  const audience = findingAudienceForRole(input.role);
  const findings = Array.isArray(input.records?.findingRecords) ? input.records.findingRecords : [];
  return findings.map((record) => CustomerFindingRecordView({ record, audience }));
}
