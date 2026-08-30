import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import canonicalize from "canonicalize";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifiedOutcome } from "../../../packages/protocol-ts/test/helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-epic-5-control-plane-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-epic-5-dist");

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const cp = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const name of ["buildSecurityReviewAttestation", "buildStaticBundleGeneratedEvent", "projectSecurityReviewAttestation", "buildAttestationGeneratedEvent", "projectApprovedSupportingEvidenceMapping", "buildAttestationPackageFinalization", "buildAttestationPackageFinalizedEvent", "buildAttestationPackageExportedEvent", "buildPilotMetricRecord", "buildPilotFeedbackRecord", "buildPilotMetricEvent", "buildPilotFeedbackEvent", "projectInternalPilotLearning"]) assert(name in cp, `missing public export ${name}`);

  const [attestation, mapping, reviewScope, bundle, receipt, minimization, deletion, addendumFixture, classification, guidance, validationPath, validationScript, verificationEvidence, verificationRecord, verificationScope] = await Promise.all([
    fixture("security-review-attestation.json"), fixture("supporting-evidence-mapping.soc2.json"), fixture("review-scope.json"), fixture("bundle-manifest.json"), fixture("vendor-receipt.json"), fixture("evidence-minimization-projection.json"), fixture("deletion-evidence.json"), fixture("verification-addendum.finalized.json"), fixture("finding-classification-record.requires-validation.json"), fixture("finding-remediation-guidance.requires-validation-path-only.json"), fixture("finding-validation-path.customer-run-script.json"), fixture("reviewer-validation-script.included-slot-1.json"), fixture("verification-evidence-record.customer-validation.json"), fixture("verification-record.complete.json"), fixture("verification-pass-scope.requires-validation-path.json")
  ]);
  const historyEvents = await exactHistory(cp, { receipt, deletion, classification, guidance, validationPath, validationScript, verificationEvidence, verificationRecord });
  // C4-25: the fixture's own `history_refs` are unresolvable placeholder
  // hashes (never a real event's canonical identity) -- they only ever
  // existed to exercise addendum *shape*, not the canonical addendum
  // boundary. Rebind them to the real, hash-consistent verification_evidence_
  // recorded/verification_recorded events already built above so this
  // addendum can pass `projectVerificationAddendum` end to end.
  const addendum = {
    ...addendumFixture,
    history_refs: [
      historyEvents.find((event) => event.event_type === "verification_evidence_recorded").event_id,
      historyEvents.find((event) => event.event_type === "verification_recorded").event_id
    ]
  };
  const storedValidationOutputClassification = { protocol_version: "codeattest.v0", stored_object_ref: "stored_object:synthetic-validation-output", object_kind: "evidence_artifact", source_derived_class: "retained_review_artifact", environment_profile: "synthetic_demo", artifact_ref: "artifact_ref:synthetic_validation_output" };
  const addendumContext = {
    verification_scope: verificationScope,
    verification_scope_history: [verificationScope],
    trusted_tenant_id: "tenant:synthetic-demo",
    review_scope: reviewScope,
    classification,
    classifications: [classification],
    remediation_guidance: guidance,
    validation_path: validationPath,
    validation_paths: [validationPath],
    reviewer_validation_script: validationScript,
    reviewer_validation_scripts: [validationScript],
    stored_object_classifications: [storedValidationOutputClassification],
    verification_records: [verificationRecord],
    evidence_records: [verificationEvidence],
    evidence_record_history: [verificationEvidence],
    deletion_evidence: [],
    lifecycle_events: [],
    history_events: historyEvents
  };
  // C4-25 positive: the addendum must independently pass the exact same
  // canonical boundary `buildSecurityReviewAttestation` will now require.
  const standaloneAddendumProjection = cp.projectVerificationAddendum(addendum, addendumContext);
  assert(standaloneAddendumProjection.outcome === "projected", `addendum fixture must pass the canonical addendum boundary standalone: ${JSON.stringify(standaloneAddendumProjection)}`);
  const attestationContext = {
    review_scope: reviewScope,
    bundle_manifest: bundle,
    vendor_receipt: receipt,
    evidence_minimization: minimization,
    evidence_minimization_ref: attestation.evidence_minimization_ref,
    deletion_evidence: [deletion],
    verification_addenda: [addendum],
    verification_addendum_contexts: { [addendum.verification_addendum_id]: addendumContext },
    classification_records: [classification],
    remediation_guidance: [guidance],
    validation_paths: [validationPath],
    validation_scripts: [validationScript],
    verification_evidence_records: [verificationEvidence],
    verification_records: [verificationRecord],
    history_events: historyEvents,
    supporting_evidence_mapping: mapping
  };

  const projected = cp.buildSecurityReviewAttestation(attestation, attestationContext);
  assert(projected.outcome === "projected", `valid attestation projects: ${JSON.stringify(projected)}`);
  assertDeepFrozen(projected.record, "attestation");
  assertRejected(cp.buildSecurityReviewAttestation({ ...attestation, limitations: [...attestation.limitations, "Changed after identity creation."] }, attestationContext), "attestation_reference_mismatch");
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, history_events: historyEvents.filter((event) => event.event_type !== "evidence_deleted") }), "attestation_history_incomplete");

  // C4-26: verification evidence/decisions are versioned -- a real,
  // properly superseding v2 event for the same record family must make the
  // v1 record (still the one the Attestation cites) inactive, even though a
  // v1 event backing it still exists earlier in the same valid history.
  const v1EvidenceEvent = historyEvents.find((event) => event.event_type === "verification_evidence_recorded");
  const supersedingEvidenceEvent = await seal(cp, {
    protocol_version: "codeattest.v0",
    event_id: zeroId(),
    review_id: attestation.review_id,
    sequence_number: historyEvents.length,
    idempotency_key: `verification_evidence:${attestation.review_id}:${verificationEvidence.verification_evidence_record_id}:record_version:2`,
    event_type: "verification_evidence_recorded",
    actor: verificationEvidence.actor,
    event_timestamp: "2026-07-30T12:15:00Z",
    artifact_refs: [`artifact_ref:${verificationEvidence.verification_evidence_record_id.slice("verification_evidence:".length)}`],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    source_derived_class: "retained_review_artifact",
    supersedes_event_id: v1EvidenceEvent.event_id
  });
  assertRejected(
    cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, history_events: [...historyEvents, supersedingEvidenceEvent] }),
    "attestation_history_incomplete"
  );

  // C4-26: a generic `artifact_ref:vendor_receipt` event only proves *some*
  // receipt was issued -- rebinding the receipt-issuance event's exact
  // identity to an unrelated (but still schema-valid) vendor receipt ID must
  // be rejected, not silently accepted because the generic ref still matches.
  const unrelatedReceiptEvent = await seal(cp, {
    ...historyEvents.find((event) => event.event_type === "receipt_issued"),
    idempotency_key: `receipt_issued:${attestation.review_id}:vendor_receipt:${"9".repeat(64)}`
  });
  assertRejected(
    cp.buildSecurityReviewAttestation(attestation, {
      ...attestationContext,
      history_events: historyEvents.map((event) => (event.event_type === "receipt_issued" ? unrelatedReceiptEvent : event))
    }),
    "attestation_history_incomplete"
  );

  // C4-26: a backing event dated after the Attestation itself claims to
  // have been generated cannot have informed it -- ref/type/timestamp
  // matching alone is not enough without this chronology bound.
  const lateClassification = { ...classification, classified_at: "2026-08-02T00:00:00Z" };
  const lateHistoryEvents = await exactHistory(cp, { receipt, deletion, classification: lateClassification, guidance, validationPath, validationScript, verificationEvidence, verificationRecord });
  assertRejected(
    cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, classification_records: [lateClassification], history_events: lateHistoryEvents }),
    "attestation_history_incomplete"
  );

  // C4-26: migrating to the canonical `storedReviewEventLogIsAppendValid`
  // replay validator (shared with the real append boundary and C4-21's
  // addendum history check) must catch authority violations the prior
  // hand-rolled checker never examined -- a `verification_evidence_recorded`
  // event from a `vendor_service` actor requires a `customer_actor_ref`
  // backing it; the old checker only ever looked at `actor_type`.
  const authorityInvalidEvidenceEvent = await seal(cp, { ...v1EvidenceEvent, actor: { actor_type: "vendor_service", actor_id: "vendor_service:synthetic-worker" } });
  assertRejected(
    cp.buildSecurityReviewAttestation(attestation, {
      ...attestationContext,
      history_events: historyEvents.map((event) => (event.event_type === "verification_evidence_recorded" ? authorityInvalidEvidenceEvent : event))
    }),
    "attestation_history_incomplete"
  );

  // C4-26: a deletion event's ref/type match alone doesn't bind WHICH
  // deletion instant backs it -- its timestamp must equal the cited
  // Deletion Evidence's own `deletion_timestamp`.
  const originalDeletionEvent = historyEvents.find((event) => event.event_type === "evidence_deleted");
  const mistimedDeletionEvent = await seal(cp, { ...originalDeletionEvent, event_timestamp: "2026-07-19T00:00:01Z" });
  assertRejected(
    cp.buildSecurityReviewAttestation(attestation, {
      ...attestationContext,
      history_events: historyEvents.map((event) => (event.event_type === "evidence_deleted" ? mistimedDeletionEvent : event))
    }),
    "attestation_history_incomplete"
  );

  // C4-26: an addendum dated after the Attestation itself claims to have
  // been generated cannot have informed it.
  const lateAddendum = { ...addendum, generated_at: "2026-08-02T00:00:00Z" };
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, verification_addenda: [lateAddendum] }), "attestation_reference_mismatch");

  // C4-31: table-driven negative matrix for the Attestation historical
  // authority guard -- one properly resealed (not just mutated) unauthorized
  // actor per event type, run through the public `buildSecurityReviewAttestation`
  // API rather than a private history helper, so the coverage survives any
  // future helper replacement (as it already did across C4-21/C4-26).
  const attestationHistoryActorMutationCases = [
    ["classification_recorded", classification.classification_record_id.slice("classification_record:".length), { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }],
    ["remediation_guidance_recorded", guidance.remediation_guidance_id.slice("remediation_guidance:".length), { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }],
    ["validation_recorded", validationPath.validation_path_id.slice("validation_path:".length), { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }],
    ["validation_recorded", validationScript.validation_script_id.slice("validation_script:".length), { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }],
    ["verification_evidence_recorded", verificationEvidence.verification_evidence_record_id.slice("verification_evidence:".length), { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" }],
    ["verification_recorded", verificationRecord.verification_record_id.slice("verification_record:".length), { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }]
  ];
  for (const [eventType, bareRecordId, unauthorizedActor] of attestationHistoryActorMutationCases) {
    const targetEvent = historyEvents.find((event) => event.event_type === eventType && event.artifact_refs[0] === `artifact_ref:${bareRecordId}`);
    const forgedEvent = await seal(cp, { ...targetEvent, actor: unauthorizedActor });
    assertRejected(
      cp.buildSecurityReviewAttestation(attestation, {
        ...attestationContext,
        history_events: historyEvents.map((event) => (event === targetEvent ? forgedEvent : event))
      }),
      "attestation_history_incomplete"
    );
  }

  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, verification_records: [{ ...verificationRecord, review_id: "review:other" }] }), "attestation_required_artifact_missing");
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, evidence_minimization: { ...minimization, entries: minimization.entries.filter((entry) => entry.deletion_evidence_ref !== deletion.deletion_evidence_id) } }), "attestation_lifecycle_invalid");
  // C4-08: every supplied Deletion Evidence item must independently pass the
  // full schema — a skeletal or malformed *extra* (unreferenced) item must
  // still reject the whole Attestation build, not just the one item a ref
  // happens to resolve to.
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, deletion_evidence: [deletion, { deletion_evidence_id: "deletion_evidence:extra-0001" }] }), "attestation_lifecycle_invalid");
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, deletion_evidence: [deletion, { deletion_evidence_id: "deletion_evidence:extra-0001", verification_status: "verified" }] }), "attestation_lifecycle_invalid");
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, deletion_evidence: [deletion, { ...deletion, deletion_evidence_id: "deletion_evidence:extra-0001", unexpected_field: "x" }] }), "attestation_lifecycle_invalid");
  assert(
    cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, deletion_evidence: [deletion, { ...deletion, deletion_evidence_id: "deletion_evidence:extra-0001" }] }).outcome === "projected",
    "a fully valid unreferenced extra deletion evidence item must not block projection"
  );

  // C4-25: every supplied addendum must now pass the exact canonical
  // `projectVerificationAddendum` boundary through the Attestation build,
  // not just ID/review-membership matching.
  // Missing a schema-required field (`history_refs`) that none of the
  // Attestation's own pre-existing per-finding checks independently
  // examine -- only the canonical addendum boundary's own schema check can
  // catch this, proving the Attestation isn't merely re-running its
  // pre-existing shallow field checks.
  const skeletalAddendum = { ...addendum };
  delete skeletalAddendum.history_refs;
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, verification_addenda: [skeletalAddendum] }), "attestation_reference_mismatch");
  // Schema-valid shape, but the canonical addendum boundary's own semantic
  // checks (forbidden text) must still reject it -- proves the Attestation
  // isn't merely re-running its pre-existing shallow field checks.
  const semanticallyInvalidAddendum = { ...addendum, limitations: ["Contact person@example.test for this bounded addendum."] };
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, verification_addenda: [semanticallyInvalidAddendum] }), "attestation_reference_mismatch");
  // Classification drift: the addendum's own bound classification is
  // untouched (so it still passes the canonical addendum boundary
  // standalone), but the Attestation's *separately supplied*
  // `classification_records` context now carries a different `classification`
  // value for the same record ID and finding -- this must be caught
  // explicitly, not assumed consistent because the IDs still line up.
  const driftedClassification = { ...classification, classification: "likely" };
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, classification_records: [driftedClassification] }), "attestation_reference_mismatch");
  // Missing context: an addendum is supplied but no context is provided for it.
  assertRejected(cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, verification_addendum_contexts: {} }), "attestation_reference_mismatch");
  // Extra/unrelated context entry alongside a correct one must also reject,
  // not be silently ignored.
  assertRejected(
    cp.buildSecurityReviewAttestation(attestation, { ...attestationContext, verification_addendum_contexts: { ...attestationContext.verification_addendum_contexts, "verification_addendum:unrelated_extra_001": addendumContext } }),
    "attestation_reference_mismatch"
  );

  const missingClassificationRef = await withIdentity(cp, { ...attestation, sections: attestation.sections.map((section) => section.section_type === "findings_and_classification" ? { ...section, supporting_artifact_refs: [] } : section) }, "attestation_id", "attestation");
  assertRejected(cp.buildSecurityReviewAttestation(missingClassificationRef, attestationContext), "attestation_schema_invalid");
  const extraOutcomeRef = await withIdentity(cp, { ...attestation, sections: attestation.sections.map((section) => section.section_type === "verification_outcomes" ? { ...section, supporting_artifact_refs: [...section.supporting_artifact_refs, "artifact_ref:unexpected"] } : section) }, "attestation_id", "attestation");
  assertRejected(cp.buildSecurityReviewAttestation(extraOutcomeRef, { ...attestationContext, supporting_evidence_mapping: { ...mapping, attestation_ref: extraOutcomeRef.attestation_id } }), "attestation_required_artifact_missing");
  const piiAttestation = await withIdentity(cp, { ...attestation, limitations: ["Contact security@example.test for this customer package."] }, "attestation_id", "attestation");
  assertRejected(cp.buildSecurityReviewAttestation(piiAttestation, { ...attestationContext, supporting_evidence_mapping: { ...mapping, attestation_ref: piiAttestation.attestation_id } }), "attestation_text_forbidden");
  const learningAttestation = await withIdentity(cp, { ...attestation, limitations: ["Internal pilot feedback says this package was useful."] }, "attestation_id", "attestation");
  assertRejected(cp.buildSecurityReviewAttestation(learningAttestation, { ...attestationContext, supporting_evidence_mapping: { ...mapping, attestation_ref: learningAttestation.attestation_id } }), "attestation_text_forbidden");

  const attestationEvent = cp.buildAttestationGeneratedEvent(attestation, envelope(20), attestationContext);
  assert(attestationEvent.outcome === "built", `attestation event builds: ${JSON.stringify(attestationEvent)}`);
  assert(attestationEvent.event.event_type === "attestation_generated" && attestationEvent.event.artifact_refs.length === 1, "attestation event has distinct type and singleton ref");
  const sealedAttestationEvent = await seal(cp, attestationEvent.event);
  assert((await cp.appendReviewEvent(emptyLog(attestation.review_id), await seal(cp, { ...attestationEvent.event, actor: { actor_type: "vendor_service" } }))).outcome === "rejected", "malformed actor fails closed");
  assert((await cp.appendReviewEvent(emptyLog(attestation.review_id), await seal(cp, { ...attestationEvent.event, reason: "Contact security@example.test with pilot feedback." }))).outcome === "rejected", "customer reason rejects PII and pilot learning content");
  let log = emptyLog(attestation.review_id);
  let appended = await cp.appendReviewEvent(log, sealedAttestationEvent);
  assert(appended.outcome === "appended", `first attestation event appends: ${JSON.stringify(appended)}`);
  log = appended.log;
  assert((await cp.appendReviewEvent(log, sealedAttestationEvent)).outcome === "idempotent_noop", "exact attestation replay is a no-op");
  const v2Record = await withIdentity(cp, { ...attestation, attestation_version: 2, generated_at: "2026-08-01T12:01:00Z" }, "attestation_id", "attestation");
  const v2Built = cp.buildAttestationGeneratedEvent(v2Record, { ...envelope(21), supersedes_event_id: sealedAttestationEvent.event_id }, { ...attestationContext, supporting_evidence_mapping: { ...mapping, attestation_ref: v2Record.attestation_id }, history_events: historyEvents });
  assert(v2Built.outcome === "built", `versioned Attestation event builds: ${JSON.stringify(v2Built)}`);
  assert((await cp.appendReviewEvent(log, await seal(cp, v2Built.event))).outcome === "appended", "higher Attestation version supersedes active family head");

  const mappingProjection = cp.projectApprovedSupportingEvidenceMapping(mapping, attestation);
  assert(mappingProjection.outcome === "projected", `approved mapping projects: ${JSON.stringify(mappingProjection)}`);
  for (const profile of ["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"]) {
    const candidate = { ...structuredClone(mapping), supporting_evidence_mapping_id: `supporting_evidence_mapping:synthetic_${profile.replaceAll("_", "-")}`, mapping_profile: profile };
    assert(cp.projectApprovedSupportingEvidenceMapping(candidate, attestation).outcome === "projected", `${profile} mapping projects through control-plane`);
  }
  assert(cp.projectApprovedSupportingEvidenceMapping({ ...mapping, approved_by: { actor_type: "vendor_service", actor_id: "vendor:svc" } }, attestation).outcome === "omitted", "mapping approval is reviewer-only");
  assert(cp.projectApprovedSupportingEvidenceMapping({ ...mapping, review_id: "review:other" }, attestation).outcome === "omitted", "cross-review mapping is omitted");

  // C4-27: JSON Schema `uniqueItems` on `entries` compares complete objects,
  // so two entries sharing one mapping_entry_id but differing elsewhere
  // (e.g. topic) pass schema validation. This must still be rejected
  // explicitly, not silently projected as an ambiguous customer-facing
  // mapping.
  const duplicateEntryMapping = await fixture("../invalid/supporting-evidence-mapping.duplicate-entry-id.json");
  const duplicateEntryResult = cp.projectApprovedSupportingEvidenceMapping({ ...duplicateEntryMapping, attestation_ref: attestation.attestation_id }, attestation);
  assert(duplicateEntryResult.outcome === "omitted" && duplicateEntryResult.reason === "supporting_evidence_mapping_duplicate_entry", `duplicate mapping entry ids must be rejected explicitly; got ${JSON.stringify(duplicateEntryResult)}`);

  // C4-31: table-driven negative matrix for the mapping narrative/claim-
  // safety guard. Each forbidden-text category is placed independently in
  // both a top-level narrative field (`decision_authority`) and a nested
  // per-entry field (`topic`), proving the check reaches both locations.
  const mappingForbiddenTextCases = [
    ["claim-unsafe overclaim", "SYNTHETIC_DEMO_DATA this confirms the application is secure. NOT_CUSTOMER_SOURCE."],
    ["source/credential text", "SYNTHETIC_DEMO_DATA api key: abc123 must not enter reviewer text. NOT_CUSTOMER_SOURCE."],
    ["PII text", "SYNTHETIC_DEMO_DATA contact alice@example.com for details. NOT_CUSTOMER_SOURCE."],
    ["internal-learning prose", "SYNTHETIC_DEMO_DATA this references internal learning notes. NOT_CUSTOMER_SOURCE."]
  ];
  for (const [, forbiddenText] of mappingForbiddenTextCases) {
    const topLevelResult = cp.projectApprovedSupportingEvidenceMapping({ ...mapping, decision_authority: forbiddenText }, attestation);
    assert(topLevelResult.outcome === "omitted" && topLevelResult.reason === "supporting_evidence_mapping_text_forbidden", `top-level forbidden text must be rejected; got ${JSON.stringify(topLevelResult)}`);
    const entryLevelMapping = { ...mapping, entries: [{ ...mapping.entries[0], topic: forbiddenText }, ...mapping.entries.slice(1)] };
    const entryLevelResult = cp.projectApprovedSupportingEvidenceMapping(entryLevelMapping, attestation);
    assert(entryLevelResult.outcome === "omitted" && entryLevelResult.reason === "supporting_evidence_mapping_text_forbidden", `entry-level forbidden text must be rejected; got ${JSON.stringify(entryLevelResult)}`);
  }

  const [finalizationBase, generatedManifest, generatedSigningInput, generatedSignature, finalizedManifest, finalizedSigningInput, signature, portal] = await Promise.all([fixture("attestation-package-finalization.json"), fixture("static-bundle-manifest.generated.json"), signingFixture("static-bundle-manifest-identity.json"), fixture("signature-envelope.static-bundle.json"), fixture("static-bundle-manifest.finalized.json"), signingFixture("static-bundle-manifest-finalized-identity.json"), fixture("signature-envelope.static-bundle-finalized.json"), fixture("static-portal-projection.json")]);
  const finalizationContext = { attestation, vendor_receipt: receipt, generated_manifest: generatedManifest, generated_manifest_signing_input: generatedSigningInput, generated_manifest_signature: generatedSignature, finalized_manifest: finalizedManifest, finalized_manifest_signing_input: finalizedSigningInput, finalized_manifest_signature: signature, portal_projection: portal, deletion_evidence: [deletion], history_events: [sealedAttestationEvent], signature_verification_outcomes: { generated_manifest: verifiedOutcome(generatedSignature), finalized_manifest: verifiedOutcome(signature), vendor_receipt: verifiedOutcome(receipt.receipt_signature) } };
  const finalized = cp.buildAttestationPackageFinalization(finalizationBase, finalizationContext);
  assert(finalized.outcome === "projected", `customer finalization projects: ${JSON.stringify(finalized)}`);

  // C4-24 / D3-2: `receipt_verification_state === "verified"` is a claim the
  // caller supplies, not a fact. With real ML-DSA-65 bytes the control plane
  // cannot re-derive the signature itself, so the fact it re-checks is the
  // independently produced outcome -- one that reports a failure, or that
  // describes a different receipt, must each be rejected rather than trusted.
  for (const outcomeOverrides of [{ result: "signature_bytes_untrusted" }, { signed_identity: `sha256:${"0".repeat(64)}` }, { key_version: "some-other-key-version" }]) {
    assertRejected(
      cp.buildAttestationPackageFinalization(finalizationBase, { ...finalizationContext, signature_verification_outcomes: { ...finalizationContext.signature_verification_outcomes, vendor_receipt: { ...verifiedOutcome(receipt.receipt_signature), ...outcomeOverrides } } }),
      "attestation_finalization_receipt_invalid"
    );
  }

  // C4-24: a schema-valid portal with a duplicate section (and, as a
  // consequence, a missing one) must be rejected on semantics, not just
  // schema/cross-ref shape.
  const duplicateSectionPortal = { ...portal, navigation: [...portal.navigation.slice(0, 7), { ...portal.navigation[0], order: 8 }] };
  assertRejected(cp.buildAttestationPackageFinalization(finalizationBase, { ...finalizationContext, portal_projection: duplicateSectionPortal }), "attestation_finalization_portal_invalid");

  // C4-24: the supplied Attestation must be the unique active version
  // represented by history -- a stale (superseded) Attestation body with a
  // higher-version sibling present in history must be rejected even though
  // its own identity recomputes correctly.
  const supersedingAttestationWithId = await withIdentity(
    cp,
    { ...attestation, attestation_version: 2, limitations: [...attestation.limitations, "SYNTHETIC_DEMO_DATA superseding version. NOT_CUSTOMER_SOURCE."] },
    "attestation_id",
    "attestation"
  );
  const supersedingEvent = cp.buildAttestationGeneratedEvent(supersedingAttestationWithId, envelope(50), { ...attestationContext, supporting_evidence_mapping: { ...mapping, attestation_ref: supersedingAttestationWithId.attestation_id } });
  assert(supersedingEvent.outcome === "built", `superseding attestation event must build; got ${JSON.stringify(supersedingEvent)}`);
  const sealedSupersedingEvent = await seal(cp, supersedingEvent.event);
  assertRejected(
    cp.buildAttestationPackageFinalization(finalizationBase, { ...finalizationContext, history_events: [sealedAttestationEvent, sealedSupersedingEvent] }),
    "attestation_finalization_reference_mismatch"
  );
  assertRejected(cp.buildAttestationPackageFinalization(finalizationBase, { ...finalizationContext, finalized_manifest: { ...finalizedManifest, files: [] } }), "attestation_finalization_reference_mismatch");
  assertRejected(cp.buildAttestationPackageFinalization(finalizationBase, { ...finalizationContext, finalized_manifest_signature: { ...signature, signature_bytes: "not-a-real-signature" } }), "attestation_finalization_reference_mismatch");
  const generatedEvent = cp.buildStaticBundleGeneratedEvent(generatedManifest, envelope(29));
  assert(generatedEvent.outcome === "built" && generatedEvent.event.artifact_refs.join() === generatedManifest.static_bundle_manifest_id && generatedEvent.event.idempotency_key.includes(generatedManifest.static_bundle_manifest_id.slice(7)), "generated event binds exact manifest fields and identity");

  // C4-23: schema/package-state/identity validity says nothing about static-
  // manifest semantics -- a correctly rehashed manifest carrying internal
  // pilot-learning content, duplicate/unresolved refs, or incomplete
  // minimization coverage must still be rejected before it can back a
  // customer-facing generated event.
  const internalLearningManifest = await fixture("../invalid/static-bundle-manifest.internal-learning-file.json");
  assertRejected(cp.buildStaticBundleGeneratedEvent(internalLearningManifest, envelope(29)), "static_bundle_event_semantics_invalid");

  const duplicatePathManifest = await withIdentity(cp, { ...generatedManifest, files: [...generatedManifest.files, generatedManifest.files[generatedManifest.files.length - 1]] }, "static_bundle_manifest_id", "sha256");
  assertRejected(cp.buildStaticBundleGeneratedEvent(duplicatePathManifest, envelope(29)), "static_bundle_event_semantics_invalid");

  const missingMinimizationManifest = await withIdentity(cp, { ...generatedManifest, minimization_disposition: { ...generatedManifest.minimization_disposition, included_retained_refs: generatedManifest.minimization_disposition.included_retained_refs.slice(1) } }, "static_bundle_manifest_id", "sha256");
  assertRejected(cp.buildStaticBundleGeneratedEvent(missingMinimizationManifest, envelope(29)), "static_bundle_event_semantics_invalid");

  const unresolvedBundleRefManifest = await withIdentity(cp, { ...generatedManifest, evidence_bundle_representation: { ...generatedManifest.evidence_bundle_representation, bundle_manifest_ref: "artifact_ref:nonexistent_bundle_manifest" } }, "static_bundle_manifest_id", "sha256");
  assertRejected(cp.buildStaticBundleGeneratedEvent(unresolvedBundleRefManifest, envelope(29)), "static_bundle_event_semantics_invalid");

  // Also enforced inside finalization for both the generated and finalized
  // manifest: apply the identical duplicate-file mutation to *both* (so the
  // pre-existing files/minimization/verification_metadata stableEquals chain
  // check between them still passes) and re-identify each so the failure is
  // provably semantic, not the pre-existing chain-equality or stale-identity
  // check.
  const duplicatedFiles = [...generatedManifest.files, generatedManifest.files[generatedManifest.files.length - 1]];
  const semanticInvalidGeneratedManifest = await withIdentity(cp, { ...generatedManifest, files: duplicatedFiles }, "static_bundle_manifest_id", "sha256");
  const semanticInvalidFinalizedManifest = await withIdentity(cp, { ...finalizedManifest, files: duplicatedFiles }, "static_bundle_manifest_id", "sha256");
  assertRejected(
    cp.buildAttestationPackageFinalization(finalizationBase, { ...finalizationContext, generated_manifest: semanticInvalidGeneratedManifest, finalized_manifest: semanticInvalidFinalizedManifest }),
    "attestation_finalization_manifest_chain_invalid"
  );
  const finalizedEvent = cp.buildAttestationPackageFinalizedEvent(finalizationBase, envelope(30), finalizationContext);
  assert(finalizedEvent.outcome === "built", `finalized event builds: ${JSON.stringify(finalizedEvent)}`);
  assert(finalizedEvent.event.artifact_refs.join() === finalizationBase.finalized_manifest_ref && finalizedEvent.event.idempotency_key.includes(finalizationBase.static_bundle_id) && finalizedEvent.event.idempotency_key.includes(finalizationBase.finalized_manifest_ref.slice(7)), "finalized event binds stable bundle family, finalization record, and finalized manifest identity");
  const sealedGenerated = await seal(cp, generatedEvent.event);
  const sealedFinalized = await seal(cp, finalizedEvent.event);
  assert((await cp.appendReviewEvent(emptyLog(finalizationBase.review_id), sealedFinalized)).outcome === "rejected", "finalization cannot append before generated manifest event");
  let finalLog = emptyLog(finalizationBase.review_id);
  const generatedAppend = await cp.appendReviewEvent(finalLog, sealedGenerated); assert(generatedAppend.outcome === "appended", "generated event appends first"); finalLog = generatedAppend.log;
  // C4-03: superseding the real generated-manifest event with a forged
  // overflow version must be rejected as unparseable identity — a naive
  // Number() parse still compares greater than the real prior version (1),
  // so this must be caught by identity parsing, not version ordering.
  for (const overflowVersion of ["9007199254740992", "9007199254740993", "9".repeat(400)]) {
    const forgedSupersedingGenerated = await seal(cp, {
      ...sealedGenerated,
      sequence_number: 999,
      idempotency_key: sealedGenerated.idempotency_key.replace("manifest_version:1", `manifest_version:${overflowVersion}`),
      supersedes_event_id: sealedGenerated.event_id
    });
    assertRejected(await cp.appendReviewEvent(finalLog, forgedSupersedingGenerated), "review_event_epic5_version_invalid");
  }
  // C4-04: a finalization claiming a different (manifest-B) generated
  // manifest must be rejected even though a real generated event (manifest
  // A) for the same review/family exists — matching review+family+sequence
  // alone is not enough to prove this finalization was actually built from
  // the generated event that is present.
  const forgedFinalizationWrongGeneratedManifest = await seal(cp, {
    ...sealedFinalized,
    idempotency_key: sealedFinalized.idempotency_key.replace(`generated_manifest_id:${generatedManifest.static_bundle_manifest_id.slice(7)}`, `generated_manifest_id:${"b".repeat(64)}`)
  });
  assertRejected(await cp.appendReviewEvent(finalLog, forgedFinalizationWrongGeneratedManifest), "review_event_epic5_version_invalid");
  const firstFinal = await cp.appendReviewEvent(finalLog, sealedFinalized);
  assert(firstFinal.outcome === "appended", "finalization event appends after generation");
  finalLog = firstFinal.log;
  const exportedRecord = { ...finalizationBase, export_state: "exported", exported_at: "2026-08-01T12:30:00Z" };
  const exportedEvent = cp.buildAttestationPackageExportedEvent(exportedRecord, envelope(31), finalizationContext);
  assert(exportedEvent.outcome === "built", `export event builds: ${JSON.stringify(exportedEvent)}`);
  const sealedExported = await seal(cp, exportedEvent.event);
  // C4-04: an export claiming a different finalization record id (same
  // review, family, and version) must be rejected — a same-family,
  // same-version finalization existing is not enough to prove this export
  // was actually built from the specific finalization that is present.
  const forgedExportWrongFinalizationRecord = await seal(cp, {
    ...sealedExported,
    idempotency_key: sealedExported.idempotency_key.replace(`record_id:${finalizationBase.attestation_package_finalization_id.slice("attestation_finalization:".length)}`, `record_id:${"c".repeat(64)}`)
  });
  assertRejected(await cp.appendReviewEvent(finalLog, forgedExportWrongFinalizationRecord), "review_event_epic5_version_invalid");
  assert((await cp.appendReviewEvent(emptyLog(finalizationBase.review_id), sealedExported)).outcome === "rejected", "export cannot append before finalization");
  assert((await cp.appendReviewEvent(finalLog, sealedExported)).outcome === "appended", "export appends after matching finalization");
  const earlyExportRecord = { ...finalizationBase, export_state: "exported", exported_at: "2026-08-01T12:19:59Z" };
  assertRejected(cp.buildAttestationPackageExportedEvent(earlyExportRecord, envelope(32), finalizationContext), "attestation_finalization_export_state_invalid");

  // C4-29: table-driven negative matrix for the finalized/exported event-
  // envelope builder branches, which previously had only valid-envelope and
  // early-export-state coverage. Each case mutates exactly one envelope
  // field from a fresh envelope so it exercises one branch in isolation.
  const finalizationEnvelopeMutationCases = [
    ["wrong artifact ref", (env) => ({ ...env, artifact_refs: [`sha256:${"1".repeat(64)}`] }), "attestation_finalization_event_missing_record_ref"],
    ["empty artifact refs", (env) => ({ ...env, artifact_refs: [] }), "attestation_finalization_event_missing_record_ref"],
    ["extra artifact ref", (env) => ({ ...env, artifact_refs: [finalizationBase.finalized_manifest_ref, `sha256:${"2".repeat(64)}`] }), "attestation_finalization_event_missing_record_ref"],
    ["actor different from customer actor", (env) => ({ ...env, actor: { actor_type: "vendor_service", actor_id: "vendor_service:synthetic-intake" } }), "attestation_finalization_event_actor_mismatch"],
    ["caller-supplied wrong idempotency key", (env) => ({ ...env, idempotency_key: "wrong-idempotency-key" }), "attestation_finalization_event_idempotency_key_not_derived"],
    ["timestamp override", (env) => ({ ...env, event_timestamp: "2026-01-01T00:00:00Z" }), "attestation_finalization_event_schema_invalid"],
    ["visibility override", (env) => ({ ...env, visibility: "internal_only" }), "attestation_finalization_event_schema_invalid"],
    ["invalid event id", (env) => ({ ...env, event_id: "not-a-valid-event-id" }), "attestation_finalization_event_schema_invalid"],
    // C4-29: these events are fixed-visibility customer_facing and never
    // carry a reviewer note -- an envelope-supplied `internal_note` was
    // previously silently dropped rather than rejected (see production fix).
    ["internal_note on fixed customer-facing event", (env) => ({ ...env, internal_note: "should never be accepted here" }), "attestation_finalization_event_schema_invalid"]
  ];
  for (const [, mutate, expectedReason] of finalizationEnvelopeMutationCases) {
    assertRejected(cp.buildAttestationPackageFinalizedEvent(finalizationBase, mutate(envelope(60)), finalizationContext), expectedReason);
    assertRejected(cp.buildAttestationPackageExportedEvent(exportedRecord, mutate(envelope(61)), finalizationContext), expectedReason);
  }
  assertRejected(cp.buildAttestationPackageFinalizedEvent(finalizationBase, { ...envelope(62), event_type: "attestation_package_exported" }, finalizationContext), "attestation_finalization_event_type_mismatch");
  assertRejected(cp.buildAttestationPackageExportedEvent(exportedRecord, { ...envelope(63), event_type: "attestation_package_finalized" }, finalizationContext), "attestation_finalization_event_type_mismatch");
  // C4-29: the export builder must reject a record that isn't actually
  // exported yet, independent of the separate exported_at-ordering check
  // (`attestation_finalization_export_state_invalid`) covered above.
  assertRejected(cp.buildAttestationPackageExportedEvent(finalizationBase, envelope(64), finalizationContext), "attestation_finalization_event_state_invalid");

  const [metric, feedback] = await Promise.all([fixture("pilot-metric-record.json"), fixture("pilot-feedback-record.json")]);
  assert(cp.buildPilotMetricRecord(metric).outcome === "recorded", "content-free metric records internally");
  assert(cp.buildPilotFeedbackRecord(feedback).outcome === "recorded", "PII-free feedback records internally");
  assertRejected(cp.buildPilotMetricRecord({ ...metric, metrics: { ...metric.metrics, actionable_classification_count: metric.metrics.classified_finding_count + 1 } }), "pilot_learning_metric_inconsistent");
  assertRejected(cp.buildPilotMetricRecord({ ...metric, measurement_window: { start_timestamp: metric.measurement_window.end_timestamp, end_timestamp: metric.measurement_window.end_timestamp } }), "pilot_learning_time_window_invalid");
  assertRejected(cp.buildPilotMetricRecord({ ...metric, metrics: { ...metric.metrics, review_hours: Number.POSITIVE_INFINITY } }), "pilot_learning_schema_invalid");
  assertRejected(cp.buildPilotFeedbackRecord({ ...feedback, mapping_feedback: [feedback.mapping_feedback[0], feedback.mapping_feedback[0]] }), "pilot_learning_schema_invalid");
  // C4-28: an email address in caveats is now caught earlier by the new
  // whole-record `containsPiiValue` scan (pilot_learning_pii_forbidden),
  // superseding the narrower caveat-only text check this used to hit first.
  assertRejected(cp.buildPilotFeedbackRecord({ ...feedback, caveats: ["Contact person@example.test for details."] }), "pilot_learning_pii_forbidden");
  // C4-28: `recorded_by.actor_id` must be an opaque namespaced identifier --
  // this alone rejects every email/phone/free-text shape, since none of
  // those characters are in the allowed suffix charset -- and every field's
  // *value* (not just caveats) is scanned for PII-shaped text.
  assertRejected(cp.buildPilotMetricRecord({ ...metric, recorded_by: { ...metric.recorded_by, actor_id: "person@example.test" } }), "pilot_learning_pii_forbidden");
  assertRejected(cp.buildPilotFeedbackRecord({ ...feedback, recorded_by: { ...feedback.recorded_by, actor_id: "+1 (555) 123-4567" } }), "pilot_learning_pii_forbidden");
  // Mismatched namespace: an otherwise opaque-looking ID whose prefix does
  // not equal its own actor_type must still reject, not merely "looks opaque".
  assertRejected(cp.buildPilotMetricRecord({ ...metric, recorded_by: { ...metric.recorded_by, actor_id: "reviewer:synthetic-amelia" } }), "pilot_learning_pii_forbidden");
  // Nested PII string value in an unrelated field name (not actor_id, not
  // caveats) must still be caught by the recursive whole-record scan.
  assertRejected(cp.buildPilotFeedbackRecord({ ...feedback, feedback_source: "customer_admin_aggregate", mapping_feedback: [{ ...feedback.mapping_feedback[0] }], objection_codes: [...feedback.objection_codes, "other_content_free"], caveats: [...feedback.caveats, "See notes for jane.doe@example.test"] }), "pilot_learning_pii_forbidden");
  const validOpaqueMetric = cp.buildPilotMetricRecord({ ...metric, recorded_by: { ...metric.recorded_by, actor_id: "vendor_service:pilot-worker-007" } });
  assert(validOpaqueMetric.outcome === "recorded", `a valid opaque actor ID must still be accepted; got ${JSON.stringify(validOpaqueMetric)}`);

  // C4-30: pilot fail-closed boundary matrix. `recorded_by.actor_type`,
  // `visibility`, `content_free`, and `pii_free` are all schema-`const`/enum
  // pinned, so these mutations fail at the closed schema before ever
  // reaching the runtime authority/content/PII checks -- asserting the
  // actual stable outward reason (`pilot_learning_schema_invalid`) documents
  // that fail-closed behavior explicitly rather than assuming it.
  const pilotMutationCases = [
    ["unauthorized actor", (r) => ({ ...r, recorded_by: { ...r.recorded_by, actor_type: "customer_user" } }), "pilot_learning_schema_invalid"],
    ["customer-facing visibility", (r) => ({ ...r, visibility: "customer_facing" }), "pilot_learning_schema_invalid"],
    ["content_free:false", (r) => ({ ...r, content_free: false }), "pilot_learning_schema_invalid"],
    ["pii_free:false", (r) => ({ ...r, pii_free: false }), "pilot_learning_schema_invalid"],
    ["forbidden nested content key", (r) => ({ ...r, recorded_by: { ...r.recorded_by, payload: "forbidden" } }), "pilot_learning_schema_invalid"]
  ];
  for (const [, mutate, expectedReason] of pilotMutationCases) {
    assertRejected(cp.buildPilotMetricRecord(mutate(metric)), expectedReason);
    assertRejected(cp.buildPilotFeedbackRecord(mutate(feedback)), expectedReason);
  }

  const internalProjection = cp.projectInternalPilotLearning({ review_id: metric.review_id, metric_records: [metric], feedback_records: [feedback] });
  assert(internalProjection.outcome === "projected" && Object.isFrozen(internalProjection.projection) && Object.isFrozen(internalProjection.projection.metric_records), "internal pilot projection succeeds and is deeply immutable");
  assertRejected(cp.projectInternalPilotLearning({ review_id: "review:other", metric_records: [metric], feedback_records: [feedback] }), "pilot_learning_reference_mismatch");
  const metricEvent = cp.buildPilotMetricEvent(metric, envelope(40));
  const feedbackEvent = cp.buildPilotFeedbackEvent(feedback, envelope(41));
  assert(metricEvent.outcome === "built" && feedbackEvent.outcome === "built", "pilot events build");
  assert(metricEvent.event.visibility === "internal_only" && feedbackEvent.event.visibility === "internal_only" && metricEvent.event.reason === undefined && feedbackEvent.event.reason === undefined, "pilot events are internal and content-free");
  assert(metricEvent.event.artifact_refs[0].startsWith("sha256:") && feedbackEvent.event.artifact_refs[0].startsWith("sha256:") && metricEvent.event.artifact_refs[0] !== feedbackEvent.event.artifact_refs[0], "metric and feedback events bind distinct canonical record content");
  assert(metricEvent.event.idempotency_key.includes(":pilot_metric:") && metricEvent.event.idempotency_key.includes(":content_id:") && feedbackEvent.event.idempotency_key.includes(":pilot_feedback:") && feedbackEvent.event.idempotency_key.includes(":content_id:"), "pilot event families bind stable ids, versions, and content ids");
  let pilotLog = emptyLog(metric.review_id);
  const appendedMetric = await cp.appendReviewEvent(pilotLog, await seal(cp, metricEvent.event)); assert(appendedMetric.outcome === "appended", "metric event appends in its family"); pilotLog = appendedMetric.log;
  const appendedFeedback = await cp.appendReviewEvent(pilotLog, await seal(cp, feedbackEvent.event)); assert(appendedFeedback.outcome === "appended", "feedback event appends in its separate family");
  // C4-28: a resealed/forged pilot event reaching the append boundary
  // directly (bypassing the builder) must still fail closed on a non-opaque
  // actor ID -- the record itself isn't part of the event, but the event's
  // own actor.actor_id mirrors it.
  const forgedPilotEvent = await seal(cp, { ...metricEvent.event, actor: { actor_type: "vendor_service", actor_id: "person@example.test" } });
  assertRejected(await cp.appendReviewEvent(emptyLog(metric.review_id), forgedPilotEvent), "review_event_pilot_pii_forbidden");
  // C4-30: build a valid event, mutate actor/visibility/reason, reseal it
  // (recomputing event_id from the mutated content -- without this the test
  // would only prove identity mismatch, not the intended authority guard),
  // and assert the direct-append boundary fails closed. A fresh empty log is
  // used for each case.
  const directAppendMutationCases = [
    ["unauthorized actor type", (e) => ({ ...e, actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" } }), "review_event_epic5_authority_invalid"],
    ["customer-facing visibility", (e) => ({ ...e, visibility: "customer_facing" }), "review_event_epic5_authority_invalid"],
    ["non-empty reason", (e) => ({ ...e, reason: "Pilot metric recorded." }), "review_event_epic5_authority_invalid"]
  ];
  for (const [, mutate, expectedReason] of directAppendMutationCases) {
    const mutatedEvent = await seal(cp, mutate(metricEvent.event));
    assertRejected(await cp.appendReviewEvent(emptyLog(metric.review_id), mutatedEvent), expectedReason);
  }
  // Invalid records cannot produce an aggregate projection -- one bad actor
  // ID anywhere in the batch fails the whole projection closed, not just the
  // one record.
  const piiMetric = { ...metric, recorded_by: { ...metric.recorded_by, actor_id: "person@example.test" } };
  assertRejected(cp.projectInternalPilotLearning({ review_id: metric.review_id, metric_records: [piiMetric], feedback_records: [feedback] }), "pilot_learning_pii_forbidden");
  const customerHistory = cp.projectCustomerFacingHistory({ protocol_version: metric.protocol_version, review_id: metric.review_id, events: [await seal(cp, attestationEvent.event), await seal(cp, metricEvent.event), await seal(cp, feedbackEvent.event)] });
  assert(customerHistory.entries.map((entry) => entry.event_type).join(",") === "attestation_generated", "customer history excludes all pilot events");

  for (const builder of [
    () => cp.buildSecurityReviewAttestation(cyclic(attestation), attestationContext),
    () => cp.projectApprovedSupportingEvidenceMapping(cyclic(mapping), attestation),
    () => cp.buildAttestationPackageFinalization(cyclic(finalizationBase), finalizationContext),
    () => cp.buildPilotMetricRecord(cyclic(metric)),
    () => cp.buildPilotFeedbackRecord(cyclic(feedback))
  ]) assertDoesNotThrow(builder);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane Epic 5 tests passed.");

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
async function signingFixture(name) { return JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "signing-inputs", name), "utf8")); }
function envelope(sequence_number) { return { event_id: zeroId(), sequence_number }; }
function emptyLog(review_id) { return { protocol_version: "codeattest.v0", review_id, events: [] }; }
function zeroId() { return `sha256:${"0".repeat(64)}`; }
async function seal(cp, event) { const draft = { ...event, event_id: zeroId() }; return { ...draft, event_id: await cp.computeReviewEventId(draft) }; }
async function withIdentity(_cp, record, field, namespace) { const copy = structuredClone(record); delete copy[field]; const digest = createHash("sha256").update(canonicalize(copy), "utf8").digest("hex"); return { ...copy, [field]: `${namespace}:${digest}` }; }
async function exactHistory(cp, records) {
  const reviewId = records.classification.review_id;
  const specs = [
    ["receipt_issued", "artifact_ref:vendor_receipt", records.receipt.receipt_timestamp, { actor_type: "vendor_service", actor_id: "vendor_service:synthetic-intake" }, `receipt_issued:${reviewId}:vendor_receipt:${records.receipt.vendor_receipt_id.slice("sha256:".length)}`, undefined],
    ["classification_recorded", `artifact_ref:${records.classification.classification_record_id.slice("classification_record:".length)}`, records.classification.classified_at, records.classification.actor, `classification:${reviewId}:${records.classification.classification_record_id}`, undefined],
    ["remediation_guidance_recorded", `artifact_ref:${records.guidance.remediation_guidance_id.slice("remediation_guidance:".length)}`, records.guidance.authored_at, records.guidance.actor, `remediation_guidance:${reviewId}:${records.guidance.remediation_guidance_id}`, undefined],
    ["validation_recorded", `artifact_ref:${records.validationPath.validation_path_id.slice("validation_path:".length)}`, records.validationPath.authored_at, records.validationPath.actor, `validation_path:${reviewId}:${records.validationPath.validation_path_id}`, undefined],
    ["validation_recorded", `artifact_ref:${records.validationScript.validation_script_id.slice("validation_script:".length)}`, records.validationScript.authored_at, records.validationScript.actor, `validation_script:${reviewId}:${records.validationScript.validation_script_id}`, `Validation script package status: included_base_package; included script slot: ${records.validationScript.included_script_slot}.`],
    ["verification_evidence_recorded", `artifact_ref:${records.verificationEvidence.verification_evidence_record_id.slice("verification_evidence:".length)}`, records.verificationEvidence.recorded_at, records.verificationEvidence.actor, `verification_evidence:${reviewId}:${records.verificationEvidence.verification_evidence_record_id}:record_version:${records.verificationEvidence.record_version}`, undefined],
    ["verification_recorded", `artifact_ref:${records.verificationRecord.verification_record_id.slice("verification_record:".length)}`, records.verificationRecord.recorded_at, records.verificationRecord.actor, `verification_record:${reviewId}:${records.verificationRecord.verification_record_id}:record_version:${records.verificationRecord.record_version}`, undefined],
    ["evidence_deleted", `artifact_ref:${records.deletion.deletion_evidence_id.slice("deletion_evidence:".length)}`, records.deletion.deletion_timestamp, records.deletion.actor, "deletion:synthetic", undefined]
  ];
  let log = emptyLog(reviewId);
  for (const [event_type, artifact_ref, event_timestamp, actor, idempotency_key, reason] of specs) {
    const draft = { protocol_version: "codeattest.v0", event_id: zeroId(), review_id: reviewId, sequence_number: log.events.length, idempotency_key, event_type, actor, event_timestamp, artifact_refs: [artifact_ref], visibility: "customer_facing", canonicalization: "rfc8785", identity_hash_algorithm: "sha256", identity_input_excludes: ["event_id"], source_derived_class: event_type === "evidence_deleted" ? "transient_source_derived" : "retained_review_artifact", ...(reason === undefined ? {} : { reason }) };
    const appended = await cp.appendReviewEvent(log, await seal(cp, draft));
    assert(appended.outcome === "appended", `history event must pass append boundary: ${JSON.stringify(appended)}`);
    log = appended.log;
  }
  return log.events;
}
function cyclic(value) { const copy = { ...value }; copy.self = copy; return copy; }
function assertRejected(result, reason) { assert(result.outcome === "rejected", `expected ${reason}, got ${JSON.stringify(result)}`); assert(result.reason === reason, `expected ${reason}, got ${result.reason}`); }
function assertDoesNotThrow(run) { try { const result = run(); assert(result.outcome === "rejected" || result.outcome === "omitted", `malformed input fails closed: ${JSON.stringify(result)}`); } catch (error) { throw new Error(`boundary threw: ${error}`); } }
function assertDeepFrozen(value, label) { if (value === null || typeof value !== "object") return; assert(Object.isFrozen(value), `${label} must be deeply frozen`); for (const child of Object.values(value)) assertDeepFrozen(child, label); }
function assert(condition, message) { if (!condition) throw new Error(message); }
