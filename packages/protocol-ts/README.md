# Protocol TypeScript Package

Home for generated or validated TypeScript protocol bindings and validators.

Story 1.3 owns the first real protocol schema and fixture content. Generated binding drift must be checked by local and CI gates once bindings exist.

Generated bindings are derived from `protocol/` artifacts only. `protocol/` must never depend on this package or treat generated TypeScript bindings as protocol authority.

Epic 4 generated bindings include `VerificationEvidenceRecord`, `VerificationRecord`, and `VerificationAddendum`. The focused protocol test verifies closed metadata-only evidence intake, canonical reviewer decision vocabulary, reviewer actor shape, exact before/after fields, and standalone addendum closure. Legacy decision labels may be normalized by adapters at input boundaries, but generated protocol output uses only `verification_complete`, `verification_pending`, `not_verified`, and `requires_customer_side_validation`.

Epic 5 generated bindings include `SecurityReviewAttestation`, `SupportingEvidenceMapping`, `StaticBundleManifest`, `StaticPortalProjection`, `AttestationPackageFinalization`, `PilotMetricRecord`, and `PilotFeedbackRecord`. `epic-5-protocol.test.mjs` checks their closed shapes, authority boundaries, offline/static flags, finalization versioning, internal-learning visibility, and generated schema registration. The Attestation-specific claim profile permits factual artifact names and bounded supporting-evidence wording while rejecting assurance, acceptance, certification, control-satisfaction, security-guarantee, source-content, and credential claims. Generated files under `src/generated/` remain generator-owned and must never be hand-edited.
