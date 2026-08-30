// Story 3.4: validation paths and reviewer-authored scripts are typed
// retained review artifacts recorded through the existing append-only review log.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-validation-path-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-validation-path-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const exportName of ["buildFindingValidationPathEvent", "buildReviewerValidationScriptEvent", "appendReviewEvent", "projectCustomerFacingFindingRecord"]) {
    assert(exportName in controlPlane, `missing public export: ${exportName}`);
  }

  const classification = await readFixture("finding-classification-record.requires-validation.json");
  const guidance = await readFixture("finding-remediation-guidance.requires-validation-path-only.json");
  const pathRecord = await readFixture("finding-validation-path.customer-run-script.json");
  const remotePath = await readFixture("finding-validation-path.remote-dynamic-testing.json");
  const manualPath = await readFixture("finding-validation-path.manual-steps.json");
  const script = await readFixture("reviewer-validation-script.included-slot-1.json");
  const scriptSlot3 = await readFixture("reviewer-validation-script.included-slot-3.json");
  const additionalScript = await readFixture("reviewer-validation-script.additional-pricing-tbd.json");

  await testBuildAppendAndIdempotency(controlPlane, classification, pathRecord, script);
  testPathBranchAndBindingGuardrails(controlPlane, classification, guidance, pathRecord, remotePath, manualPath, script);
  testScriptPackageAllocation(controlPlane, pathRecord, script, scriptSlot3, additionalScript);
  await testAppendBoundaryBackstops(controlPlane, pathRecord, script, scriptSlot3);
  testCustomerProjectionSeparatesValidation(controlPlane, classification, guidance, pathRecord, remotePath, manualPath, script, additionalScript);
  testMalformedInputsReturnUnions(controlPlane, pathRecord, script);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane validation path tests passed.");

async function testBuildAppendAndIdempotency(controlPlane, classification, pathRecord, script) {
  const classificationEvent = await buildSealedClassificationEvent(controlPlane, classification, 0);
  assert(classificationEvent.outcome === "built", `classification precondition must build; got ${JSON.stringify(classificationEvent)}`);
  const first = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: pathRecord.review_id, events: [] }, classificationEvent.event);
  assert(first.outcome === "appended", "classification precondition must append");

  const pathEvent = await buildSealedPathEvent(controlPlane, pathRecord, 1, { reviewer_validation_scripts: [script], prior_included_scripts: [] });
  assert(pathEvent.outcome === "built", `validation path event must build; got ${JSON.stringify(pathEvent)}`);
  assert(pathEvent.event.event_type === "validation_recorded", "validation path uses the existing validation_recorded event vocabulary");
  assert(pathEvent.event.artifact_refs.includes("artifact_ref:synthetic_script_001"), "validation path event references its typed artifact");
  assert(pathEvent.event.actor.actor_type === "reviewer", "validation path event is reviewer-authored");
  assert(pathEvent.event.idempotency_key === `validation_path:${pathRecord.review_id}:${pathRecord.validation_path_id}`, "validation path idempotency derives from typed path identity");
  const pathAppend = await controlPlane.appendReviewEvent(first.log, pathEvent.event);
  assert(pathAppend.outcome === "appended", `validation path append must succeed; got ${JSON.stringify(pathAppend)}`);

  const scriptEvent = await buildSealedScriptEvent(controlPlane, script, 2, { validation_path: pathRecord, prior_included_scripts: [] });
  assert(scriptEvent.outcome === "built", `validation script event must build; got ${JSON.stringify(scriptEvent)}`);
  assert(scriptEvent.event.event_type === "validation_recorded", "validation script also uses validation_recorded event vocabulary");
  assert(scriptEvent.event.artifact_refs.includes("artifact_ref:synthetic_included_001"), "validation script event references its typed artifact");
  assert(scriptEvent.event.idempotency_key === `validation_script:${script.review_id}:${script.validation_script_id}`, "validation script idempotency derives from typed script identity");
  const scriptAppend = await controlPlane.appendReviewEvent(pathAppend.log, scriptEvent.event);
  assert(scriptAppend.outcome === "appended", `validation script append must succeed; got ${JSON.stringify(scriptAppend)}`);

  const replay = await controlPlane.appendReviewEvent(scriptAppend.log, scriptEvent.event);
  assert(replay.outcome === "idempotent_noop", "identical validation script replay is idempotent");
}

function testPathBranchAndBindingGuardrails(controlPlane, classification, guidance, pathRecord, remotePath, manualPath, script) {
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...pathRecord, classification_record_ref: "classification_record:unrelated" }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...pathRecord, source_reference_state: "retained_review_artifact" }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_source_reference_state_mismatch"
  );
  const remoteWithoutAuth = { ...remotePath };
  delete remoteWithoutAuth.authorization_assumption;
  assertRejected(
    controlPlane.buildFindingValidationPathEvent(remoteWithoutAuth, envelopeFor(0), { classification, remediation_guidance: guidance, prior_included_scripts: [] }),
    "validation_path_remote_authorization_required"
  );
  const scriptWithoutRef = { ...pathRecord, reviewer_validation_script_refs: [] };
  assertRejected(
    controlPlane.buildFindingValidationPathEvent(scriptWithoutRef, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [], prior_included_scripts: [] }),
    "validation_path_script_ref_required"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [], prior_included_scripts: [] }),
    "validation_path_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...manualPath, reviewer_validation_script_refs: [script.validation_script_id] }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_branch_field_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...pathRecord, target: remotePath.target }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_branch_field_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...manualPath, target: remotePath.target }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [], prior_included_scripts: [] }),
    "validation_path_branch_field_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...pathRecord, reviewer_validation_script_refs: [script.validation_script_id] }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [{ ...script, validation_path_ref: "validation_path:other_path" }], prior_included_scripts: [] }),
    "validation_path_reference_mismatch"
  );
  const manualWithoutAttachment = { ...manualPath };
  delete manualWithoutAttachment.output_attachment_instructions;
  assertRejected(
    controlPlane.buildFindingValidationPathEvent(manualWithoutAttachment, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [], prior_included_scripts: [] }),
    "validation_path_manual_attachment_instructions_required"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...manualPath, review_finding_draft_evidence_refs: [{ artifact_ref: "artifact_ref:synthetic_deleted_without_proof", availability_state: "deleted_under_policy", available_for_review: false, display_state: "deleted", source_derived_class: "transient_source_derived" }], source_reference_state: "deleted_under_policy" }, envelopeFor(0), { reviewer_validation_scripts: [], prior_included_scripts: [] }),
    "validation_path_evidence_ref_unbound"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...pathRecord, steps: "SYNTHETIC_DEMO_DATA token: unsafe marker. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_text_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent({ ...pathRecord, expected_result: "SYNTHETIC_DEMO_DATA validation path must not claim no vulnerabilities. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_text_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingValidationPathEvent(pathRecord, { ...envelopeFor(0), actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, { classification, remediation_guidance: guidance, reviewer_validation_scripts: [script], prior_included_scripts: [] }),
    "validation_path_event_actor_mismatch"
  );
}

function testScriptPackageAllocation(controlPlane, pathRecord, script, scriptSlot3, additionalScript) {
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent({ ...script, included_script_slot: undefined }, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] }),
    "validation_script_included_slot_required"
  );
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent({ ...script, included_script_slot: 4 }, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] }),
    "validation_script_included_slot_required"
  );
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent({ ...additionalScript, included_script_slot: 2 }, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] }),
    "validation_script_additional_slot_forbidden"
  );
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent({ ...script, expected_output: "SYNTHETIC_DEMO_DATA script must not claim independent assurance. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] }),
    "validation_script_text_forbidden"
  );
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), { validation_path: undefined, prior_included_scripts: [] }),
    "validation_script_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent({ ...script, validation_path_ref: "validation_path:synthetic_manual_001" }, envelopeFor(0), { validation_path: { ...pathRecord, validation_path_id: "validation_path:synthetic_manual_001", path_type: "manual_steps", reviewer_validation_script_refs: undefined }, prior_included_scripts: [] }),
    "validation_script_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent({
      ...additionalScript,
      purpose: "SYNTHETIC_DEMO_DATA additional script without separate cost posture. NOT_CUSTOMER_SOURCE.",
      prerequisites: "SYNTHETIC_DEMO_DATA run only after separate agreement applies. NOT_CUSTOMER_SOURCE.",
      execution_steps: "SYNTHETIC_DEMO_DATA execute the additional candidate script only after customer approval. NOT_CUSTOMER_SOURCE.",
      script_content: "#!/usr/bin/env node\nconsole.log('SYNTHETIC_DEMO_DATA additional output NOT_CUSTOMER_SOURCE');"
    }, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] }),
    "validation_script_pricing_tbd_required"
  );
  const pricingOnlyInScriptContent = {
    ...additionalScript,
    purpose: "SYNTHETIC_DEMO_DATA additional script candidate pending separate customer review. NOT_CUSTOMER_SOURCE.",
    prerequisites: "SYNTHETIC_DEMO_DATA run only after separate agreement applies. NOT_CUSTOMER_SOURCE.",
    execution_steps: "SYNTHETIC_DEMO_DATA execute the additional candidate script only after customer approval. NOT_CUSTOMER_SOURCE.",
    expected_output: "SYNTHETIC_DEMO_DATA output would become customer-provided validation evidence if approved. NOT_CUSTOMER_SOURCE.",
    safety_notes: "SYNTHETIC_DEMO_DATA additional script is not included in the base package. NOT_CUSTOMER_SOURCE.",
    output_attachment_instructions: "SYNTHETIC_DEMO_DATA attach output only if separately approved. NOT_CUSTOMER_SOURCE.",
    script_content: "#!/usr/bin/env node\nconsole.log('SYNTHETIC_DEMO_DATA additional validation output pricing TBD NOT_CUSTOMER_SOURCE');"
  };
  const pricingOnlyResult = controlPlane.buildReviewerValidationScriptEvent(pricingOnlyInScriptContent, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] });
  assert(pricingOnlyResult.outcome === "built", `pricing TBD copy in script_content must satisfy additional-script posture; got ${JSON.stringify(pricingOnlyResult)}`);
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [script, scriptSlot3, { ...script, validation_script_id: "validation_script:synthetic_included_002", included_script_slot: 2 }] }),
    "validation_script_included_cap_exceeded"
  );
}

async function testAppendBoundaryBackstops(controlPlane, pathRecord, script, scriptSlot3) {
  const forgedCustomerPath = await sealEvent(controlPlane, {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: pathRecord.review_id,
    sequence_number: 0,
    idempotency_key: `validation_path:${pathRecord.review_id}:${pathRecord.validation_path_id}`,
    event_type: "validation_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic" },
    event_timestamp: "2026-07-28T00:00:00Z",
    artifact_refs: ["artifact_ref:synthetic_script_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"]
  });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: pathRecord.review_id, events: [] }, forgedCustomerPath), "review_event_validation_reviewer_actor_required");

  const forgedGenericCustomerValidation = await sealEvent(controlPlane, { ...forgedCustomerPath, idempotency_key: "validation-legacy-forged", artifact_refs: ["artifact_ref:legacy_validation"], event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: pathRecord.review_id, events: [] }, forgedGenericCustomerValidation), "review_event_validation_reviewer_actor_required");

  const forgedReviewerGenericValidation = await sealEvent(controlPlane, { ...forgedGenericCustomerValidation, actor: pathRecord.actor, event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: pathRecord.review_id, events: [] }, forgedReviewerGenericValidation), "review_event_schema_invalid");

  const forgedExtraRefs = await sealEvent(controlPlane, { ...forgedCustomerPath, actor: pathRecord.actor, artifact_refs: ["artifact_ref:synthetic_script_001", "artifact_ref:unrelated"], event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: pathRecord.review_id, events: [] }, forgedExtraRefs), "review_event_schema_invalid");

  const builtScript = await buildSealedScriptEvent(controlPlane, script, 0, { validation_path: pathRecord, prior_included_scripts: [] });
  assert(builtScript.outcome === "built", "script event precondition builds before append-boundary supersedes check");
  const appended = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: script.review_id, events: [] }, builtScript.event);
  assert(appended.outcome === "appended", "script event append precondition succeeds");
  const builtScriptSlot3 = await buildSealedScriptEvent(controlPlane, scriptSlot3, 1, { validation_path: pathRecord, prior_included_scripts: [script] });
  assert(builtScriptSlot3.outcome === "built", "third-slot script event builds before append package checks");
  const appendedSlot3 = await controlPlane.appendReviewEvent(appended.log, builtScriptSlot3.event);
  assert(appendedSlot3.outcome === "appended", "third-slot script event append succeeds");
  const duplicateSlotScript = { ...script, validation_script_id: "validation_script:synthetic_duplicate_slot_001", purpose: "SYNTHETIC_DEMO_DATA duplicate included slot should be rejected at append. NOT_CUSTOMER_SOURCE.", authored_at: "2026-07-28T00:09:00Z" };
  const duplicateSlotEvent = await buildSealedScriptEvent(controlPlane, duplicateSlotScript, 2, { validation_path: pathRecord, prior_included_scripts: [] });
  assert(duplicateSlotEvent.outcome === "built", "append boundary owns cross-log duplicate slot enforcement even if the builder lacks prior context");
  assertRejected(await controlPlane.appendReviewEvent(appendedSlot3.log, duplicateSlotEvent.event), "review_event_validation_script_included_cap_exceeded");
  const customerRewrite = await sealEvent(controlPlane, {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: script.review_id,
    sequence_number: 1,
    idempotency_key: "customer_remediation:review:synthetic-demo-001:customer_status:synthetic_rewrite_001",
    event_type: "customer_remediation_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic" },
    event_timestamp: "2026-07-28T00:20:00Z",
    artifact_refs: ["artifact_ref:synthetic_rewrite_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    supersedes_event_id: builtScript.event.event_id
  });
  assertRejected(await controlPlane.appendReviewEvent(appended.log, customerRewrite), "customer_event_cannot_supersede_expert_record");
}

function testCustomerProjectionSeparatesValidation(controlPlane, classification, guidance, pathRecord, remotePath, manualPath, script, additionalScript) {
  const projected = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [{ ...pathRecord, reviewer_validation_script_refs: [script.validation_script_id, additionalScript.validation_script_id] }],
    reviewer_validation_scripts: [script, additionalScript],
    evidence_consumer_export: "include"
  });
  assert(projected.outcome === "projected", `projection with validation paths/scripts must succeed; got ${JSON.stringify(projected)}`);
  assert(projected.record.validation_paths.length === 1, "projection carries formal validation paths separately");
  assert(projected.record.reviewer_validation_scripts.length === 2, "projection carries reviewer scripts separately");
  assert(projected.record.verification_state.status === "not_verified", "path/script existence is not verification");
  assert(projected.record.validation_paths[0].path_type === "customer_run_script", "path type remains visible");
  assert(projected.record.reviewer_validation_scripts.some((candidate) => candidate.script_package_status === "additional_script_candidate_pricing_tbd" && candidate.pricing_note.includes("pricing TBD")), "additional-script candidate preserves pricing TBD copy");
  assert(projected.record.reviewer_validation_scripts.some((candidate) => candidate.script_content === script.script_content), "customer-facing projection carries approved script content");

  const remoteProjection = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [remotePath],
    reviewer_validation_scripts: []
  });
  assert(remoteProjection.outcome === "projected", `remote path projection must succeed; got ${JSON.stringify(remoteProjection)}`);
  assert(remoteProjection.record.validation_paths[0].target === remotePath.target, "remote testing target is customer-visible");
  assert(remoteProjection.record.validation_paths[0].authorization_assumption === remotePath.authorization_assumption, "remote testing authorization assumption is customer-visible");
  assert(remoteProjection.record.validation_paths[0].method === remotePath.method, "remote testing method is customer-visible");
  assert(remoteProjection.record.validation_paths[0].safety_constraints === remotePath.safety_constraints, "remote testing safety constraints are customer-visible");
  assert(remoteProjection.record.validation_paths[0].evidence_artifacts_to_collect.includes("artifact_ref:synthetic_remote_validation_output"), "remote evidence artifacts to collect are customer-visible");

  const manualProjection = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [manualPath],
    reviewer_validation_scripts: []
  });
  assert(manualProjection.outcome === "projected", `manual path projection must succeed; got ${JSON.stringify(manualProjection)}`);
  assert(manualProjection.record.validation_paths[0].path_type === "manual_steps", "manual-step path remains separate from scripts and remote testing");

  const internalPath = { ...pathRecord, visibility: "internal_only" };
  const internalProjection = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [internalPath],
    reviewer_validation_scripts: [script]
  });
  assert(internalProjection.outcome === "rejected", "customer-facing scripts cannot dangle behind internal-only paths");
  assert(internalProjection.reason === "customer_facing_finding_reference_mismatch", `expected cross-visibility rejection; got ${internalProjection.reason}`);

  const internalScriptProjection = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [pathRecord],
    reviewer_validation_scripts: [{ ...script, visibility: "internal_only" }]
  });
  assert(internalScriptProjection.outcome === "rejected", "customer-facing script paths cannot project refs to internal-only scripts");
  assert(internalScriptProjection.reason === "customer_facing_finding_reference_mismatch", `expected script cross-visibility rejection; got ${internalScriptProjection.reason}`);

  const backReferenceMismatch = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [pathRecord],
    reviewer_validation_scripts: [{ ...script, validation_path_ref: "validation_path:synthetic_manual_001" }]
  });
  assert(backReferenceMismatch.outcome === "rejected", "projector rejects path/script back-reference mismatches");
  assert(backReferenceMismatch.reason === "customer_facing_finding_input_invalid", `expected back-reference rejection; got ${backReferenceMismatch.reason}`);

  const verifiedByPath = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    validation_paths: [pathRecord],
    reviewer_validation_scripts: [script],
    verification_record_ref: "verification_record:synthetic_001"
  });
  assert(verifiedByPath.outcome === "projected", "verification reference may be present for Epic 4 handoff");
  assert(verifiedByPath.record.verification_state.status === "verification_pending", "verification reference is pending, not complete, in Story 3.4");
}

function testMalformedInputsReturnUnions(controlPlane, pathRecord, script) {
  for (const value of [null, "path", 42, []]) {
    assertRejected(controlPlane.buildFindingValidationPathEvent(value, envelopeFor(0), { prior_included_scripts: [] }), "validation_path_schema_invalid");
    assertRejected(controlPlane.buildReviewerValidationScriptEvent(value, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [] }), "validation_script_schema_invalid");
  }
  assertRejected(controlPlane.buildFindingValidationPathEvent(pathRecord, null, { prior_included_scripts: [] }), "validation_path_schema_invalid");
  assertRejected(controlPlane.buildReviewerValidationScriptEvent(script, null, { validation_path: pathRecord, prior_included_scripts: [] }), "validation_script_schema_invalid");
  assertRejected(controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), null), "validation_path_reference_mismatch");
  assertRejected(controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), { classification: null, reviewer_validation_scripts: [script] }), "validation_path_reference_mismatch");
  assertRejected(controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), { remediation_guidance: null, reviewer_validation_scripts: [script] }), "validation_path_reference_mismatch");
  assertRejected(controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), null), "validation_script_reference_mismatch");
  assertRejected(controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), { validation_path: null, prior_included_scripts: [] }), "validation_script_reference_mismatch");
  assertRejected(controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), { reviewer_validation_scripts: [null], prior_included_scripts: [] }), "validation_path_reference_mismatch");
  assertRejected(controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), { reviewer_validation_scripts: [undefined], prior_included_scripts: [] }), "validation_path_reference_mismatch");
  assertRejected(controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [null] }), "validation_script_reference_mismatch");
  assertRejected(controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), { validation_path: pathRecord, prior_included_scripts: [undefined] }), "validation_script_reference_mismatch");

  // C4-12: a schema-invalid referenced script/path must not become authority
  // merely because its id matches.
  const { actor: _scriptActor, ...schemaInvalidScript } = script;
  assertRejected(
    controlPlane.buildFindingValidationPathEvent(pathRecord, envelopeFor(0), { reviewer_validation_scripts: [schemaInvalidScript], prior_included_scripts: [] }),
    "validation_path_reference_mismatch"
  );
  const { actor: _pathActor, ...schemaInvalidPath } = pathRecord;
  assertRejected(
    controlPlane.buildReviewerValidationScriptEvent(script, envelopeFor(0), { validation_path: schemaInvalidPath, prior_included_scripts: [] }),
    "validation_script_reference_mismatch"
  );
}

function envelopeFor(sequence_number) {
  return { event_id: `sha256:${"0".repeat(64)}`, sequence_number };
}

async function buildSealedClassificationEvent(controlPlane, classification, sequenceNumber) {
  const draft = controlPlane.buildFindingClassificationEvent(classification, envelopeFor(sequenceNumber));
  if (draft.outcome !== "built") {
    return draft;
  }
  return { outcome: "built", event: await sealEvent(controlPlane, draft.event) };
}

async function buildSealedPathEvent(controlPlane, record, sequenceNumber, context) {
  const draft = controlPlane.buildFindingValidationPathEvent(record, envelopeFor(sequenceNumber), context);
  if (draft.outcome !== "built") {
    return draft;
  }
  return { outcome: "built", event: await sealEvent(controlPlane, draft.event) };
}

async function buildSealedScriptEvent(controlPlane, record, sequenceNumber, context) {
  const draft = controlPlane.buildReviewerValidationScriptEvent(record, envelopeFor(sequenceNumber), context);
  if (draft.outcome !== "built") {
    return draft;
  }
  return { outcome: "built", event: await sealEvent(controlPlane, draft.event) };
}

async function sealEvent(controlPlane, event) {
  return { ...event, event_id: await controlPlane.computeReviewEventId(event) };
}

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertRejected(result, expectedReason) {
  assert(result.outcome === "rejected", `expected rejection ${expectedReason}, got ${JSON.stringify(result)}`);
  assert(result.reason === expectedReason, `expected ${expectedReason}, got ${result.reason}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
