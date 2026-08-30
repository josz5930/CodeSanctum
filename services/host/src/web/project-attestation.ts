import type { AuthenticatedActor, EvidenceAccessRole } from "../../../../packages/identity-store/src/index.js";
import {
  AttestationBuilderView,
  AttestationFinalizationView,
  StaticBundleGenerationView,
  SupportingEvidenceMappingView,
  type AppShellView,
  type AttestationBuilderViewContract,
  type AttestationFinalizationViewContract,
  type StaticBundleGenerationViewContract,
  type SupportingEvidenceMappingViewContract
} from "../../../../packages/ui/src/index.js";
import { findingAudienceForRole } from "./project-finding-record.js";
import { projectContext } from "./project-context.js";
import type { ReviewRecordSet } from "./record-store.js";

export type AttestationView = {
  shell: AppShellView;
  reviewScope: string;
  attestation: AttestationBuilderViewContract;
  finalization: AttestationFinalizationViewContract;
  supportingEvidenceMapping: SupportingEvidenceMappingViewContract | null;
  staticBundle: StaticBundleGenerationViewContract;
};

/**
 * The mapping builder cross-checks that a mapping belongs to this attestation,
 * so the review/attestation identities come from the attestation record, not
 * from the mapping (which would make the check tautological).
 */
function attestationRefs(attestation: unknown): { reviewId: string; attestationId: string } | null {
  if (attestation === null || typeof attestation !== "object" || Array.isArray(attestation)) {
    return null;
  }
  const record = attestation as Record<string, unknown>;
  if (typeof record.review_id !== "string" || typeof record.attestation_id !== "string") {
    return null;
  }
  return { reviewId: record.review_id, attestationId: record.attestation_id };
}

/**
 * Read + pre-action-confirmation projection of the Epic-5 attestation contracts.
 * Audience is derived from the grant's role; the finalization surface writes
 * nothing (E-11) and only a customer actor may confirm it. Every builder
 * fail-closes to its own "unavailable" state for missing or malformed records.
 */
export function projectAttestation(input: {
  actor: AuthenticatedActor;
  role: EvidenceAccessRole;
  reviewScope: string;
  records: ReviewRecordSet | undefined;
}): AttestationView {
  const audience = findingAudienceForRole(input.role);
  const refs = attestationRefs(input.records?.attestation);
  return {
    shell: projectContext(input.actor),
    reviewScope: input.reviewScope,
    attestation: AttestationBuilderView({ attestation: input.records?.attestation, audience }),
    finalization: AttestationFinalizationView({
      context: input.records?.attestationFinalization,
      actor: input.actor.actor
    }),
    supportingEvidenceMapping:
      input.records?.supportingEvidenceMapping === undefined || refs === null
        ? null
        : SupportingEvidenceMappingView({
            mapping: input.records.supportingEvidenceMapping,
            reviewId: refs.reviewId,
            attestationId: refs.attestationId
          }),
    staticBundle: StaticBundleGenerationView({ bundle: input.records?.staticBundle, audience: "customer" })
  };
}
