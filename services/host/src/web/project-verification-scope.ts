import type { EvidenceAccessRole } from "../../../../packages/identity-store/src/index.js";
import {
  VerificationPassScopeView,
  type VerificationPassScopeViewContract
} from "../../../../packages/ui/src/index.js";
import { findingAudienceForRole } from "./project-finding-record.js";
import type { ReviewRecordSet } from "./record-store.js";

/**
 * Read-only projection of the verification-pass-scope record. The builder
 * always emits the non-dismissible scope-limitation disclosure and fail-closes
 * to an "unavailable" view when no valid scope record exists.
 */
export function projectVerificationScope(input: {
  role: EvidenceAccessRole;
  records: ReviewRecordSet | undefined;
}): VerificationPassScopeViewContract | null {
  if (input.records?.verificationPassScope === undefined) {
    return null;
  }
  return VerificationPassScopeView({
    scope: input.records.verificationPassScope,
    audience: findingAudienceForRole(input.role)
  });
}
