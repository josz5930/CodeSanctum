import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const validFixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-evidence-storage-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-evidence-storage-test-dist");

// The Story 2.5 boundary must stay pure: no filesystem, network, process, or
// managed-service reach, so it cannot become a covert real-storage path.
//
// Scope: a textual scan of `apps/control-plane/src/**/*.ts` only. It does not
// analyze transitive dependencies and does not sandbox the runtime.
//
// Module specifiers are matched with the `node:` prefix optional and subpaths
// allowed, because `import fs from "fs"` and `"node:fs/promises"` are the same
// capability as `"node:fs"`. Package names are anchored to import-specifier
// context so ordinary prose ("expression", ".jpg") cannot trip them.
const FORBIDDEN_CORE_MODULES = [
  "fs",
  "net",
  "http",
  "https",
  "http2",
  "tls",
  "dns",
  "child_process",
  "dgram",
  "worker_threads",
  "cluster",
  "vm",
  "process",
  "os",
  "path",
  "readline",
  "inspector",
  // `module` is the single-line bypass for everything above it:
  // `import { createRequire } from "node:module"` hands back a `require` this
  // scan would never see again.
  "module",
  "crypto",
  "zlib",
  "v8",
  "async_hooks",
  "perf_hooks",
  "diagnostics_channel",
  "trace_events",
  "repl",
  "tty"
];
const FORBIDDEN_PACKAGES = [
  "firestore",
  "@google-cloud/[a-z0-9-]+",
  "aws-sdk",
  "@aws-sdk/[a-z0-9-]+",
  "pg",
  "mysql2?",
  "mongodb",
  "ioredis",
  "redis",
  "amqplib",
  "kafkajs",
  "@grpc/[a-z0-9-]+",
  "express",
  "fastify",
  "koa",
  "node-fetch",
  "undici",
  "axios",
  "@azure/[a-z0-9-]+",
  "@prisma/client",
  "sqlite3",
  "better-sqlite3",
  "knex",
  "sequelize",
  "typeorm",
  "mssql",
  "cassandra-driver",
  "bullmq",
  "bull",
  "nats",
  "got",
  "superagent"
];

// `import x from "spec"`, `from "spec"`, `require("spec")`, `import("spec")`.
function specifierPatterns(specifiers, { allowSubpath }) {
  const suffix = allowSubpath ? "(?:/[a-z0-9._/-]+)?" : "";
  return specifiers.map((specifier) => {
    const body = `(?:node:)?(?:${specifier})${suffix}`;
    return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*|\\brequire\\s*)\\(?\\s*["'\`]${body}["'\`]`, "i");
  });
}

const FORBIDDEN_SOURCE_PATTERNS = [
  ...specifierPatterns(FORBIDDEN_CORE_MODULES, { allowSubpath: true }),
  ...specifierPatterns(FORBIDDEN_PACKAGES, { allowSubpath: true }),
  // Network reach that needs no import at all.
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\s*\(/,
  /\bnew\s+Worker\s*\(/,
  /\bprocess\s*\.\s*(?:binding|dlopen)\b/
];

// Nothing the boundary emits may carry source-derived content.
const FORBIDDEN_OUTPUT_SUBSTRINGS = [
  "eval(",
  "api_key=",
  "password=",
  "secret=",
  "BEGIN PRIVATE KEY",
  "Traceback",
  "at Object.<anonymous>"
];

try {
  const sourceFiles = await collectTypeScriptSources(path.join(workspacePath, "src"));
  assert(sourceFiles.length > 0, "control-plane must have TypeScript sources to check");
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
      assert(!pattern.test(source), `Story 2.5 boundary must stay pure; found ${pattern} in ${path.relative(workspacePath, sourceFile)}`);
    }
  }

  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "control-plane.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const exportName of [
    "classifyStoredObject",
    "appendEvidenceLifecycleEvent",
    "recordOptInRetention",
    "enforceScopedAccess",
    "buildEvidenceMinimizationProjection"
  ]) {
    assert(exportName in controlPlane, `missing public export: ${exportName}`);
  }

  const fixtures = {
    evidenceArtifact: await readValidFixture("stored-object-classification.evidence-artifact.json"),
    logTrace: await readValidFixture("stored-object-classification.log-trace.json"),
    optInPilot: await readValidFixture("stored-object-classification.opt-in-pilot.json"),
    accessed: await readValidFixture("evidence-lifecycle-event.accessed.json"),
    deleted: await readValidFixture("evidence-lifecycle-event.deleted.json"),
    retentionStatus: await readValidFixture("evidence-lifecycle-event.retention-status-changed.json"),
    deletionEvidence: await readValidFixture("deletion-evidence.json"),
    optInRecord: await readValidFixture("retention-opt-in-record.json"),
    minimization: await readValidFixture("evidence-minimization-projection.json")
  };
  // C4-06: appendEvidenceLifecycleEvent now resolves retention/deletion
  // companion artifacts, so any call whose candidate must actually pass
  // (append, idempotent replay, or a rejection for some other reason) needs
  // this context. fixtures.deletionEvidence / fixtures.optInRecord already
  // exactly match fixtures.deleted / fixtures.retentionStatus.
  fixtures.lifecycleContext = {
    retention_opt_in_records: [fixtures.optInRecord],
    deletion_evidence: [fixtures.deletionEvidence]
  };

  testClassifyEvidenceArtifact(controlPlane, fixtures);
  testClassifyLogWithSourceDerivedClass(controlPlane, fixtures);
  testOptInOutsidePilotProfile(controlPlane, fixtures);
  testDeletionEventWithEvidence(controlPlane, fixtures);
  testDeletionEventWithoutEvidence(controlPlane, fixtures);
  testAccessEventWithoutScope(controlPlane, fixtures);
  testNonMonotonicAppend(controlPlane, fixtures);
  testRewritingAppend(controlPlane, fixtures);
  testIdempotentReAppend(controlPlane, fixtures);
  testEvidenceLifecycleHistoryValidation(controlPlane, fixtures);
  testLifecycleCompanionResolution(controlPlane, fixtures);
  testOptInRecordAccepted(controlPlane, fixtures);
  testOptInRecordMissingPeriodOrApproval(controlPlane, fixtures);
  testOptInRecordNanosecondPrecisionWindow(controlPlane, fixtures);
  testScopedAccessAllowed(controlPlane, fixtures);
  testScopedAccessOutOfScope(controlPlane, fixtures);
  testMinimizationCategoryMismatch(controlPlane, fixtures);
  testMinimizationDeletedWithoutEvidence(controlPlane, fixtures);
  testMinimizationDanglingDeletionEvidence(controlPlane, fixtures);
  testMinimizationRejectsSkeletalExtraDeletionEvidence(controlPlane, fixtures);
  testProjectionDistinctness(controlPlane, fixtures);
  testArtifactUnderTwoCategories(controlPlane, fixtures);
  testUnknownRoleIsDenied(controlPlane, fixtures);
  testStaticConsumerMayReadNonSensitiveArtifacts(controlPlane, fixtures);
  testStaticConsumerDeniedSensitiveClasses(controlPlane, fixtures);
  testMalformedScopeIsInvalidRequest(controlPlane, fixtures);
  testAccessEventNotAppendable(controlPlane, fixtures);
  testAppendRejectsCorruptPriorSequence(controlPlane, fixtures);
  testNextSequenceNumberRejectsUnsafeLog(controlPlane, fixtures);
  testReplayedAccessStaysAllowed(controlPlane, fixtures);
  testAccessAppendsOntoNonEmptyLog(controlPlane, fixtures);
  testSupersedesLink(controlPlane, fixtures);
  testMalformedInputsReturnReasonCodes(controlPlane, fixtures);
  testReturnedArtifactsAreDeepCopies(controlPlane, fixtures);
  testSchemaBackstopsAreReachable(controlPlane, fixtures);
  testSourceScanCatchesForbiddenForms();
  testOutputsCarryNoSourceDerivedContent(controlPlane, fixtures);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane evidence storage boundary tests passed.");

function testClassifyEvidenceArtifact(controlPlane, fixtures) {
  const result = controlPlane.classifyStoredObject(fixtures.evidenceArtifact);
  assert(result.outcome === "classified", `evidence artifact must classify; got ${JSON.stringify(result)}`);
  assert(
    result.classification.source_derived_class === "transient_source_derived",
    "the classification must carry exactly the declared retention class"
  );

  const nonSource = controlPlane.classifyStoredObject(fixtures.logTrace);
  assert(nonSource.outcome === "classified", "a never_collected log_or_trace must classify");

  const pilotOptIn = controlPlane.classifyStoredObject(fixtures.optInPilot);
  assert(pilotOptIn.outcome === "classified", "opt-in retained source must classify under the real-snippet-ready profile");
}

function testClassifyLogWithSourceDerivedClass(controlPlane, fixtures) {
  for (const objectKind of ["log_or_trace", "analytics_record", "crash_report", "support_attachment"]) {
    for (const sourceClass of ["transient_source_derived", "customer_opt_in_retained_source"]) {
      const result = controlPlane.classifyStoredObject({
        ...fixtures.logTrace,
        object_kind: objectKind,
        source_derived_class: sourceClass,
        environment_profile: "partner_pilot_real_snippet_ready"
      });
      assertRejectedWith(result, "stored_object_forbidden_source_class");
    }
  }
}

function testOptInOutsidePilotProfile(controlPlane, fixtures) {
  for (const profile of ["synthetic_demo", "partner_pilot_candidate"]) {
    const result = controlPlane.classifyStoredObject({ ...fixtures.optInPilot, environment_profile: profile });
    assertRejectedWith(result, "stored_object_opt_in_not_allowed");
  }
}

function testDeletionEventWithEvidence(controlPlane, fixtures) {
  const prior = [fixtures.accessed, fixtures.retentionStatus];
  const priorSnapshot = JSON.stringify(prior);
  const result = controlPlane.appendEvidenceLifecycleEvent(prior, fixtures.deleted, fixtures.lifecycleContext);
  assert(result.outcome === "appended", `deletion event with evidence must append; got ${JSON.stringify(result)}`);
  assert(result.events.length === 3, "the appended log must keep every prior event");
  assert(JSON.stringify(prior) === priorSnapshot, "appending must not mutate the input array");
  assert(
    JSON.stringify(result.events.slice(0, 2)) === JSON.stringify(prior),
    "appending must leave every prior event byte-identical"
  );
  assert(
    result.events.at(-1).deletion_evidence_ref === fixtures.deletionEvidence.deletion_evidence_id,
    "the deletion event must reference the Deletion Evidence artifact"
  );
}

function testDeletionEventWithoutEvidence(controlPlane, fixtures) {
  const { deletion_evidence_ref: _omitted, ...withoutEvidence } = fixtures.deleted;
  const result = controlPlane.appendEvidenceLifecycleEvent([], withoutEvidence);
  assertRejectedWith(result, "deletion_event_missing_deletion_evidence");
  assert(result.events.length === 0, "a rejected append must return the prior log unchanged");

  const { source_derived_class: _class, ...withoutClass } = fixtures.deleted;
  assertRejectedWith(controlPlane.appendEvidenceLifecycleEvent([], withoutClass), "evidence_event_missing_source_derived_class");

  const { source_derived_class: _retentionClass, ...retentionWithoutClass } = fixtures.retentionStatus;
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], retentionWithoutClass),
    "evidence_event_missing_source_derived_class"
  );
}

function testAccessEventWithoutScope(controlPlane, fixtures) {
  const { access_scope: _omitted, ...withoutScope } = fixtures.accessed;
  assertRejectedWith(controlPlane.appendEvidenceLifecycleEvent([], withoutScope), "access_event_missing_scope");
}

function testNonMonotonicAppend(controlPlane, fixtures) {
  const prior = [fixtures.deleted];
  for (const sequenceNumber of [fixtures.deleted.sequence_number, fixtures.deleted.sequence_number - 1]) {
    const result = controlPlane.appendEvidenceLifecycleEvent(prior, {
      ...fixtures.accessed,
      sequence_number: sequenceNumber
    });
    assertRejectedWith(result, "evidence_event_not_append_only");
    assert(JSON.stringify(result.events) === JSON.stringify(prior), "a non-monotonic append must return the prior log unchanged");
  }
}

function testRewritingAppend(controlPlane, fixtures) {
  const prior = [fixtures.deleted];
  // Same event_id, altered body, fresh idempotency key: this is a rewrite of a
  // prior event wearing a new key, and it must not land.
  const result = controlPlane.appendEvidenceLifecycleEvent(prior, {
    ...fixtures.deleted,
    idempotency_key: `${fixtures.deleted.idempotency_key}-replay`,
    sequence_number: fixtures.deleted.sequence_number + 1,
    deletion_evidence_ref: "deletion_evidence:tampered-0001"
  });
  assertRejectedWith(result, "evidence_event_not_append_only");
  assert(JSON.stringify(result.events) === JSON.stringify(prior), "a rewriting append must return the prior log unchanged");
}

function testIdempotentReAppend(controlPlane, fixtures) {
  const prior = [fixtures.deleted];
  const replay = controlPlane.appendEvidenceLifecycleEvent(prior, { ...fixtures.deleted }, fixtures.lifecycleContext);
  assert(replay.outcome === "idempotent_noop", `replaying an event must be a no-op; got ${JSON.stringify(replay)}`);
  assert(replay.events.length === 1, "an idempotent replay must not duplicate the event");

  // C4-06: a replay must still resolve companions with *this call's*
  // context, not skip straight to idempotent_noop.
  const replayWithoutContext = controlPlane.appendEvidenceLifecycleEvent(prior, { ...fixtures.deleted });
  assertRejectedWith(replayWithoutContext, "deletion_event_deletion_evidence_unresolved");

  // A *different* body under an already-used key would rewrite history.
  const conflicting = controlPlane.appendEvidenceLifecycleEvent(prior, {
    ...fixtures.deleted,
    event_id: "evidence_event:del-0009",
    sequence_number: fixtures.deleted.sequence_number + 1
  });
  assertRejectedWith(conflicting, "evidence_event_not_append_only");
}

// C4-05: prior lifecycle entries must be validated as one append-only,
// review-bound log rather than trusted individually.
function testEvidenceLifecycleHistoryValidation(controlPlane, fixtures) {
  const valid = [fixtures.accessed, fixtures.retentionStatus];
  const validAppend = controlPlane.appendEvidenceLifecycleEvent(valid, fixtures.deleted, fixtures.lifecycleContext);
  assert(validAppend.outcome === "appended", `a genuinely valid prior history must still append; got ${JSON.stringify(validAppend)}`);

  const missingActor = { ...fixtures.retentionStatus };
  delete missingActor.actor;
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([fixtures.accessed, missingActor], fixtures.deleted),
    "evidence_event_schema_invalid"
  );

  const duplicateId = { ...fixtures.retentionStatus, event_id: fixtures.accessed.event_id };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([fixtures.accessed, duplicateId], fixtures.deleted),
    "evidence_event_not_append_only"
  );

  const duplicateKey = { ...fixtures.retentionStatus, idempotency_key: fixtures.accessed.idempotency_key };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([fixtures.accessed, duplicateKey], fixtures.deleted),
    "evidence_event_not_append_only"
  );

  const decreasingSequence = { ...fixtures.retentionStatus, sequence_number: fixtures.accessed.sequence_number - 1 };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([fixtures.accessed, decreasingSequence], fixtures.deleted),
    "evidence_event_not_append_only"
  );

  const equalSequence = { ...fixtures.retentionStatus, sequence_number: fixtures.accessed.sequence_number };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([fixtures.accessed, equalSequence], fixtures.deleted),
    "evidence_event_not_append_only"
  );

  const otherReviewEntry = { ...fixtures.retentionStatus, review_id: "review:synthetic-demo-002" };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([fixtures.accessed, otherReviewEntry], fixtures.deleted),
    "evidence_event_review_id_mismatch"
  );

  const candidateWrongReview = { ...fixtures.deleted, review_id: "review:synthetic-demo-002" };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent(valid, candidateWrongReview),
    "evidence_event_review_id_mismatch"
  );

  const scopeMismatchAccess = { ...fixtures.accessed, access_scope: { ...fixtures.accessed.access_scope, review_scope: "review:synthetic-demo-002" } };
  assertRejectedWith(controlPlane.appendEvidenceLifecycleEvent([], scopeMismatchAccess), "access_event_scope_mismatch");
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([scopeMismatchAccess], fixtures.deleted),
    "access_event_scope_mismatch"
  );
}

// C4-06: a `retention_record_ref` / `deletion_evidence_ref` string alone must
// not be trusted — it must resolve against caller-supplied companion
// artifacts and satisfy the substantive claim the reference stands in for.
function testLifecycleCompanionResolution(controlPlane, fixtures) {
  const { retention_record_ref: _ref, ...retentionWithoutRef } = fixtures.retentionStatus;
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], retentionWithoutRef, fixtures.lifecycleContext),
    "retention_event_missing_retention_record"
  );

  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.retentionStatus),
    "retention_event_record_unresolved"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.retentionStatus, { retention_opt_in_records: [{ ...fixtures.optInRecord, retention_record_id: "retention_record:other-0001" }] }),
    "retention_event_record_unresolved"
  );
  const { retained_artifact_refs: _refs, ...skeletalRetentionRecord } = fixtures.optInRecord;
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.retentionStatus, { retention_opt_in_records: [skeletalRetentionRecord] }),
    "retention_event_record_unresolved"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.retentionStatus, {
      retention_opt_in_records: [{ ...fixtures.optInRecord, retained_artifact_refs: ["artifact_ref:unrelated_snippet_001"] }]
    }),
    "retention_event_record_unresolved"
  );
  const outOfWindow = {
    ...fixtures.optInRecord,
    retention_period: { start_timestamp: "2027-01-01T00:00:00Z", end_timestamp: "2027-06-01T00:00:00Z" }
  };
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.retentionStatus, { retention_opt_in_records: [outOfWindow] }),
    "retention_event_record_unresolved"
  );
  assert(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.retentionStatus, fixtures.lifecycleContext).outcome === "appended",
    "a fully resolving retention companion must still append"
  );

  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted),
    "deletion_event_deletion_evidence_unresolved"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, { deletion_evidence: [{ ...fixtures.deletionEvidence, deletion_evidence_id: "deletion_evidence:other-0001" }] }),
    "deletion_event_deletion_evidence_unresolved"
  );
  const { verification_status: _status, ...skeletalDeletionEvidence } = fixtures.deletionEvidence;
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, { deletion_evidence: [skeletalDeletionEvidence] }),
    "deletion_event_deletion_evidence_unresolved"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, { deletion_evidence: [{ ...fixtures.deletionEvidence, verification_status: "unverified" }] }),
    "deletion_event_deletion_evidence_unresolved"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, {
      deletion_evidence: [{ ...fixtures.deletionEvidence, actor: { actor_type: "vendor_service", actor_id: "SYNTHETIC_DEMO_DATA-a-different-worker" } }]
    }),
    "deletion_event_deletion_evidence_unresolved"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, {
      deletion_evidence: [{ ...fixtures.deletionEvidence, deletion_timestamp: "2026-07-19T00:00:01Z" }]
    }),
    "deletion_event_deletion_evidence_unresolved"
  );
  assert(
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, fixtures.lifecycleContext).outcome === "appended",
    "a fully resolving deletion companion must still append"
  );
}

function testOptInRecordAccepted(controlPlane, fixtures) {
  const result = controlPlane.recordOptInRetention(fixtures.optInRecord, "partner_pilot_real_snippet_ready");
  assert(result.outcome === "recorded", `a complete opt-in record must be accepted; got ${JSON.stringify(result)}`);
  assert(
    result.record.retention_status_event_ids.includes(fixtures.retentionStatus.event_id),
    "the opt-in record must be referenceable from later retention-status events"
  );

  for (const profile of ["synthetic_demo", "partner_pilot_candidate"]) {
    assertRejectedWith(controlPlane.recordOptInRetention(fixtures.optInRecord, profile), "retention_opt_in_not_allowed");
  }
}

function testOptInRecordMissingPeriodOrApproval(controlPlane, fixtures) {
  const { retention_period: _period, ...withoutPeriod } = fixtures.optInRecord;
  assertRejectedWith(
    controlPlane.recordOptInRetention(withoutPeriod, "partner_pilot_real_snippet_ready"),
    "retention_opt_in_schema_invalid"
  );

  const { customer_approval_ref: _approval, ...withoutApproval } = fixtures.optInRecord;
  assertRejectedWith(
    controlPlane.recordOptInRetention(withoutApproval, "partner_pilot_real_snippet_ready"),
    "retention_opt_in_schema_invalid"
  );

  const inverted = {
    ...fixtures.optInRecord,
    retention_period: {
      start_timestamp: fixtures.optInRecord.retention_period.end_timestamp,
      end_timestamp: fixtures.optInRecord.retention_period.start_timestamp
    }
  };
  assertRejectedWith(controlPlane.recordOptInRetention(inverted, "partner_pilot_real_snippet_ready"), "retention_period_invalid");
}

// C4-07: retention windows must compare at nanosecond precision via
// parseUtcTimestampNs, not millisecond-truncating Date.parse.
function testOptInRecordNanosecondPrecisionWindow(controlPlane, fixtures) {
  const oneNanosecondWindow = {
    ...fixtures.optInRecord,
    retention_period: {
      start_timestamp: "2026-07-19T00:00:00.000000001Z",
      end_timestamp: "2026-07-19T00:00:00.000000002Z"
    }
  };
  const accepted = controlPlane.recordOptInRetention(oneNanosecondWindow, "partner_pilot_real_snippet_ready");
  assert(accepted.outcome === "recorded", `a one-nanosecond window must be accepted; got ${JSON.stringify(accepted)}`);

  const reversedNanoseconds = {
    ...fixtures.optInRecord,
    retention_period: {
      start_timestamp: "2026-07-19T00:00:00.000000002Z",
      end_timestamp: "2026-07-19T00:00:00.000000001Z"
    }
  };
  assertRejectedWith(
    controlPlane.recordOptInRetention(reversedNanoseconds, "partner_pilot_real_snippet_ready"),
    "retention_period_invalid"
  );

  // `Z` and `+00:00` must resolve to the same instant: an equal window
  // expressed with different offset notation must still be rejected as
  // non-positive-length, not accidentally accepted by a raw-string mismatch.
  const sameInstantDifferentNotation = {
    ...fixtures.optInRecord,
    retention_period: {
      start_timestamp: "2026-07-19T00:00:00.500000000Z",
      end_timestamp: "2026-07-19T00:00:00.500000000+00:00"
    }
  };
  assertRejectedWith(
    controlPlane.recordOptInRetention(sameInstantDifferentNotation, "partner_pilot_real_snippet_ready"),
    "retention_period_invalid"
  );
}

function testScopedAccessAllowed(controlPlane, fixtures) {
  const result = controlPlane.enforceScopedAccess([], accessRequest(fixtures));
  assert(result.decision === "allowed", `an in-scope reviewer must be allowed; got ${JSON.stringify(result)}`);
  assert(result.events.length === 1, "an allowed inspection must append exactly one access event");

  const event = result.event;
  assert(event.event_type === "evidence_accessed", "the emitted event must be evidence_accessed");
  assert(event.actor.actor_id === fixtures.accessed.actor.actor_id, "the access event must carry the acting actor");
  assert(typeof event.event_timestamp === "string" && event.event_timestamp.length > 0, "the access event must carry a timestamp");
  assert(event.artifact_refs.length === 1, "the access event must name the inspected artifact");
  assert(event.access_scope.tenant_id.length > 0 && event.access_scope.review_scope === event.review_id, "the access event must carry its scope");
  assert(typeof event.purpose === "string", "purpose must be carried through where available");

  // `purpose` is carried "where available", so an inspection without one is a
  // normal allowed access — not a schema-invalid event. This pins the
  // conditional spread that keeps the key absent rather than `undefined`.
  const withoutPurpose = accessRequest(fixtures);
  delete withoutPurpose.purpose;
  const anonymous = controlPlane.enforceScopedAccess([], withoutPurpose);
  assert(anonymous.decision === "allowed", `an inspection without a purpose must still be allowed; got ${JSON.stringify(anonymous)}`);
  assert(!("purpose" in anonymous.event), "an absent purpose must stay absent rather than become undefined");
}

function testStaticConsumerDeniedSensitiveClasses(controlPlane, fixtures) {
  // The static evidence consumer is never a party to source-derived evidence.
  // Both sensitive classes must be pinned, or the deny rule can silently narrow
  // to just the transient one.
  for (const sourceClass of ["transient_source_derived", "customer_opt_in_retained_source"]) {
    const request = accessRequest(fixtures);
    request.role = "evidence_consumer_static";
    request.artifact = { ...request.artifact, source_derived_class: sourceClass };
    const result = controlPlane.enforceScopedAccess([], request);
    assertDenied(result, "access_denied_role_not_permitted");
    assert(result.events.length === 0, `a denied ${sourceClass} inspection must append nothing`);
  }
}

function testMalformedScopeIsInvalidRequest(controlPlane, fixtures) {
  // Absent scope fields must not compare equal to each other and slip through
  // as an in-scope request that later fails to append.
  for (const missing of [undefined, ""]) {
    for (const field of ["tenant_id", "review_scope"]) {
      const request = accessRequest(fixtures);
      request[field] = missing;
      request.artifact = { ...request.artifact, [field]: missing };
      assertDenied(controlPlane.enforceScopedAccess([], request), "access_request_invalid");
    }
  }
}

function testAccessEventNotAppendable(controlPlane, fixtures) {
  // An inspection whose receipt cannot be appended must be denied, not reported
  // as allowed with nothing recorded.
  const prior = [structuredClone(fixtures.accessed)];
  const request = accessRequest(fixtures);
  request.idempotency_key = `${fixtures.accessed.idempotency_key}-fresh`;

  const result = controlPlane.enforceScopedAccess(prior, request);
  assertDenied(result, "access_event_not_appendable");
  assert(result.events.length === 1, "a denied inspection must return the prior log unchanged");
  assert(result.events[0].event_id === fixtures.accessed.event_id, "the prior log must be returned intact");
}

function testScopedAccessOutOfScope(controlPlane, fixtures) {
  const otherTenant = accessRequest(fixtures);
  otherTenant.artifact = { ...otherTenant.artifact, tenant_id: "SYNTHETIC_DEMO_DATA-tenant-2" };
  const tenantResult = controlPlane.enforceScopedAccess([], otherTenant);
  assertDenied(tenantResult, "access_denied_out_of_scope");
  assert(tenantResult.events.length === 0, "a denied inspection must append no event implying inspection occurred");

  const otherReview = accessRequest(fixtures);
  otherReview.artifact = { ...otherReview.artifact, review_scope: "review:synthetic-demo-002" };
  assertDenied(controlPlane.enforceScopedAccess([], otherReview), "access_denied_out_of_scope");

  const staticConsumer = accessRequest(fixtures);
  staticConsumer.role = "evidence_consumer_static";
  assertDenied(controlPlane.enforceScopedAccess([], staticConsumer), "access_denied_role_not_permitted");
}

function testMinimizationCategoryMismatch(controlPlane, fixtures) {
  const mismatched = {
    ...fixtures.minimization,
    entries: [{ ...deletedEntry(fixtures), source_derived_class: "retained_review_artifact" }]
  };
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection(mismatched, [fixtures.deletionEvidence]),
    "minimization_category_class_mismatch"
  );
}

function testMinimizationDeletedWithoutEvidence(controlPlane, fixtures) {
  const { deletion_evidence_ref: _omitted, ...withoutEvidence } = deletedEntry(fixtures);
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection({ ...fixtures.minimization, entries: [withoutEvidence] }, [fixtures.deletionEvidence]),
    "minimization_deleted_without_evidence"
  );
}

function testMinimizationDanglingDeletionEvidence(controlPlane, fixtures) {
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection({ ...fixtures.minimization, entries: [deletedEntry(fixtures)] }, []),
    "minimization_deletion_evidence_unresolved"
  );
}

// C4-08: every supplied Deletion Evidence item must independently pass the
// full schema, not just the one item a reference happens to resolve to —
// a skeletal or malformed *extra* item elsewhere in the array must still
// reject the whole projection.
function testMinimizationRejectsSkeletalExtraDeletionEvidence(controlPlane, fixtures) {
  const entries = [deletedEntry(fixtures)];
  const idOnlyExtra = { deletion_evidence_id: "deletion_evidence:extra-0001" };
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection({ ...fixtures.minimization, entries }, [fixtures.deletionEvidence, idOnlyExtra]),
    "minimization_projection_schema_invalid"
  );

  const idAndVerifiedExtra = { deletion_evidence_id: "deletion_evidence:extra-0001", verification_status: "verified" };
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection({ ...fixtures.minimization, entries }, [fixtures.deletionEvidence, idAndVerifiedExtra]),
    "minimization_projection_schema_invalid"
  );

  const unknownFieldExtra = { ...fixtures.deletionEvidence, deletion_evidence_id: "deletion_evidence:extra-0001", unexpected_field: "x" };
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection({ ...fixtures.minimization, entries }, [fixtures.deletionEvidence, unknownFieldExtra]),
    "minimization_projection_schema_invalid"
  );

  const fullyValidExtra = { ...fixtures.deletionEvidence, deletion_evidence_id: "deletion_evidence:extra-0001" };
  const stillProjects = controlPlane.buildEvidenceMinimizationProjection({ ...fixtures.minimization, entries }, [fixtures.deletionEvidence, fullyValidExtra]);
  assert(stillProjects.outcome === "projected", `a fully valid unreferenced extra item must not block projection; got ${JSON.stringify(stillProjects)}`);
}

function testProjectionDistinctness(controlPlane, fixtures) {
  const result = controlPlane.buildEvidenceMinimizationProjection(fixtures.minimization, [fixtures.deletionEvidence]);
  assert(result.outcome === "projected", `a well-formed projection must build; got ${JSON.stringify(result)}`);

  const categories = result.projection.entries.map((entry) => entry.minimization_category);
  for (const category of [
    "retained_finding",
    "retained_metadata",
    "retained_attestation",
    "retained_customer_opt_in_snippet",
    "deleted_transient",
    "never_collected"
  ]) {
    assert(categories.includes(category), `the projection must keep ${category} visibly distinct`);
  }
  // Deliberately NOT asserting one entry per category: a real review has many
  // `retained_finding` entries. What must hold is that a single artifact never
  // renders under two categories at once.
  const categoryByArtifact = new Map();
  for (const entry of result.projection.entries) {
    const prior = categoryByArtifact.get(entry.artifact_ref);
    assert(
      prior === undefined || prior === entry.minimization_category,
      `artifact ${entry.artifact_ref} must not appear under two categories`
    );
    categoryByArtifact.set(entry.artifact_ref, entry.minimization_category);
  }

  for (const entry of result.projection.entries) {
    if (entry.minimization_category !== "deleted_transient") {
      continue;
    }
    assert(
      entry.deletion_evidence_ref === fixtures.deletionEvidence.deletion_evidence_id,
      "a deleted_transient entry must resolve to supplied Deletion Evidence, not a dangling reference"
    );
  }
}

function testOutputsCarryNoSourceDerivedContent(controlPlane, fixtures) {
  const outputs = [
    controlPlane.classifyStoredObject(fixtures.evidenceArtifact),
    controlPlane.classifyStoredObject({ ...fixtures.optInPilot, environment_profile: "synthetic_demo" }),
    controlPlane.appendEvidenceLifecycleEvent([], fixtures.deleted, fixtures.lifecycleContext),
    controlPlane.recordOptInRetention(fixtures.optInRecord, "partner_pilot_real_snippet_ready"),
    controlPlane.enforceScopedAccess([], accessRequest(fixtures)),
    controlPlane.buildEvidenceMinimizationProjection(fixtures.minimization, [fixtures.deletionEvidence])
  ];

  for (const output of outputs) {
    const serialized = JSON.stringify(output);
    for (const forbidden of FORBIDDEN_OUTPUT_SUBSTRINGS) {
      assert(!serialized.includes(forbidden), `boundary output must not carry ${forbidden}`);
    }
    if (output.reason !== undefined) {
      assert(/^[a-z0-9_]+$/.test(output.reason), `rejection reasons must be stable codes; got ${output.reason}`);
    }
  }
}

function testArtifactUnderTwoCategories(controlPlane, fixtures) {
  const conflicted = {
    ...fixtures.minimization,
    entries: [
      deletedEntry(fixtures),
      {
        artifact_ref: deletedEntry(fixtures).artifact_ref,
        minimization_category: "retained_finding",
        source_derived_class: "retained_review_artifact"
      }
    ]
  };
  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection(conflicted, [fixtures.deletionEvidence]),
    "minimization_artifact_category_conflict"
  );

  // Repeating the *same* category for one artifact is not a conflict.
  const repeated = {
    ...fixtures.minimization,
    entries: [deletedEntry(fixtures), deletedEntry(fixtures)]
  };
  const result = controlPlane.buildEvidenceMinimizationProjection(repeated, [fixtures.deletionEvidence]);
  assert(result.outcome === "projected", `repeating one category must be allowed; got ${JSON.stringify(result)}`);
}

function testUnknownRoleIsDenied(controlPlane, fixtures) {
  // Default-deny: an unrecognized role string must not fall through to allow.
  for (const role of ["superuser", "", "CODEATTEST_REVIEWER", "codeattest_reviewer ", undefined, null, 7]) {
    const request = accessRequest(fixtures);
    request.role = role;
    assertDenied(controlPlane.enforceScopedAccess([], request), "access_denied_role_not_permitted");
  }
}

function testStaticConsumerMayReadNonSensitiveArtifacts(controlPlane, fixtures) {
  // The deny rule must stay pinned to the sensitive classes rather than
  // silently widening to the whole role.
  for (const sourceClass of ["retained_review_artifact", "never_collected"]) {
    const request = accessRequest(fixtures);
    request.role = "evidence_consumer_static";
    request.artifact = { ...request.artifact, source_derived_class: sourceClass };
    const result = controlPlane.enforceScopedAccess([], request);
    assert(
      result.decision === "allowed",
      `evidence_consumer_static must read ${sourceClass} artifacts; got ${JSON.stringify(result)}`
    );
  }
}

function testReplayedAccessStaysAllowed(controlPlane, fixtures) {
  const first = controlPlane.enforceScopedAccess([], accessRequest(fixtures));
  assert(first.decision === "allowed", "the first in-scope inspection must be allowed");

  // Replaying an identical in-scope inspection is idempotent, not a denial.
  const replay = controlPlane.enforceScopedAccess(first.events, accessRequest(fixtures));
  assert(replay.decision === "allowed", `a replayed in-scope inspection must stay allowed; got ${JSON.stringify(replay)}`);
  assert(replay.events.length === first.events.length, "a replayed inspection must not duplicate the access event");
}

function testAccessAppendsOntoNonEmptyLog(controlPlane, fixtures) {
  const prior = [fixtures.deleted];
  const request = accessRequest(fixtures);
  request.event_id = "evidence_event:acc-0007";
  request.idempotency_key = "SYNTHETIC_DEMO_DATA-acc-0007";

  const result = controlPlane.enforceScopedAccess(prior, request);
  assert(result.decision === "allowed", `an in-scope inspection must append onto a non-empty log; got ${JSON.stringify(result)}`);
  assert(result.events.length === prior.length + 1, "the access event must be appended, not replace the log");
  for (const existing of prior) {
    assert(
      result.event.sequence_number > existing.sequence_number,
      `the access event sequence_number ${result.event.sequence_number} must exceed every prior ${existing.sequence_number}`
    );
  }
}

function testSupersedesLink(controlPlane, fixtures) {
  const prior = [fixtures.accessed];
  const correction = {
    ...fixtures.retentionStatus,
    sequence_number: fixtures.accessed.sequence_number + 1,
    supersedes_event_id: fixtures.accessed.event_id
  };
  const accepted = controlPlane.appendEvidenceLifecycleEvent(prior, correction, fixtures.lifecycleContext);
  assert(accepted.outcome === "appended", `superseding a prior event must be allowed; got ${JSON.stringify(accepted)}`);

  // Self-supersession and dangling supersession are rewrite channels.
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent(prior, { ...correction, supersedes_event_id: correction.event_id }),
    "evidence_event_not_append_only"
  );
  assertRejectedWith(
    controlPlane.appendEvidenceLifecycleEvent(prior, { ...correction, supersedes_event_id: "evidence_event:never-existed" }),
    "evidence_event_not_append_only"
  );
}

function testMalformedInputsReturnReasonCodes(controlPlane, fixtures) {
  // A JS caller must get a stable reason code, never an uncaught TypeError.
  for (const events of [null, undefined, "not-an-array", 7, [null], [7]]) {
    assertRejectedWith(controlPlane.appendEvidenceLifecycleEvent(events, fixtures.deleted), "evidence_event_schema_invalid");
    assertDenied(controlPlane.enforceScopedAccess(events, accessRequest(fixtures)), "access_request_invalid");
  }

  for (const request of [null, undefined, "nope", { ...accessRequest(fixtures), artifact: null }, { ...accessRequest(fixtures), actor: null }]) {
    assertDenied(controlPlane.enforceScopedAccess([], request), "access_request_invalid");
  }

  for (const candidate of [null, undefined, "nope", []]) {
    assertRejectedWith(controlPlane.classifyStoredObject(candidate), "stored_object_schema_invalid");
    assertRejectedWith(controlPlane.recordOptInRetention(candidate, "partner_pilot_real_snippet_ready"), "retention_opt_in_schema_invalid");
  }

  for (const input of [null, undefined, "nope", { ...fixtures.minimization, entries: "nope" }, { ...fixtures.minimization, entries: [null] }]) {
    assertRejectedWith(
      controlPlane.buildEvidenceMinimizationProjection(input, [fixtures.deletionEvidence]),
      "minimization_projection_schema_invalid"
    );
  }

  for (const evidence of [null, undefined, "nope", [null]]) {
    assertRejectedWith(
      controlPlane.buildEvidenceMinimizationProjection(fixtures.minimization, evidence),
      "minimization_projection_schema_invalid"
    );
  }
}

function testReturnedArtifactsAreDeepCopies(controlPlane, fixtures) {
  const prior = [structuredClone(fixtures.accessed)];
  const priorSnapshot = JSON.stringify(prior);
  const appended = controlPlane.appendEvidenceLifecycleEvent(prior, fixtures.deleted, fixtures.lifecycleContext);
  assert(appended.outcome === "appended", "setup: the deletion event must append");

  // Reaching into a nested object of the returned log must not alter the input.
  appended.events[0].actor.actor_id = "tampered";
  appended.events[0].access_scope.tenant_id = "tampered";
  assert(JSON.stringify(prior) === priorSnapshot, "the returned log must not share nested objects with the caller's input");

  const source = structuredClone(fixtures.deleted);
  const secondAppend = controlPlane.appendEvidenceLifecycleEvent([], source, fixtures.lifecycleContext);
  assert(secondAppend.outcome === "appended", "setup: the second deletion event must append");
  source.actor.actor_id = "tampered-after-validation";
  assert(
    secondAppend.events[0].actor.actor_id !== "tampered-after-validation",
    "an appended event must not stay mutable through the caller's handle"
  );

  const classifyInput = structuredClone(fixtures.evidenceArtifact);
  const classified = controlPlane.classifyStoredObject(classifyInput);
  classifyInput.source_derived_class = "customer_opt_in_retained_source";
  assert(
    classified.classification.source_derived_class === "transient_source_derived",
    "a validated classification must not be flippable through the caller's handle"
  );

  const optInInput = structuredClone(fixtures.optInRecord);
  const recorded = controlPlane.recordOptInRetention(optInInput, "partner_pilot_real_snippet_ready");
  optInInput.retention_period.end_timestamp = "1999-01-01T00:00:00Z";
  assert(
    recorded.record.retention_period.end_timestamp !== "1999-01-01T00:00:00Z",
    "a recorded retention period must not be rewritable through the caller's handle"
  );

  // The emitted access receipt is an artifact the boundary hands back, so it
  // must be a deep copy like the rest — its `actor` came straight off the
  // caller's request.
  const accessInput = accessRequest(fixtures);
  accessInput.actor = structuredClone(accessInput.actor);
  const allowed = controlPlane.enforceScopedAccess([], accessInput);
  assert(allowed.decision === "allowed", "setup: the in-scope inspection must be allowed");
  accessInput.actor.actor_id = "tampered-after-validation";
  assert(
    allowed.event.actor.actor_id !== "tampered-after-validation",
    "the emitted access receipt must not stay mutable through the caller's handle"
  );
}

function testAppendRejectsCorruptPriorSequence(controlPlane, fixtures) {
  // Strict monotonicity compares against every prior sequence number, and a
  // comparison with a non-integer is silently false. Such a log cannot be
  // extended append-only, so it must be rejected rather than appended past.
  for (const corrupt of [Number.NaN, "3", 1.5, undefined, Number.MAX_SAFE_INTEGER + 2]) {
    const prior = [{ ...structuredClone(fixtures.accessed), sequence_number: corrupt }];
    const result = controlPlane.appendEvidenceLifecycleEvent(prior, fixtures.deleted);
    assertRejectedWith(result, "evidence_event_schema_invalid");
    assert(result.events.length === 1, "a rejected append must return the prior log unchanged");
  }
}

function testNextSequenceNumberRejectsUnsafeLog(controlPlane, fixtures) {
  const exhausted = [{ ...structuredClone(fixtures.accessed), sequence_number: Number.MAX_SAFE_INTEGER }];
  const request = accessRequest(fixtures);
  request.idempotency_key = "SYNTHETIC_DEMO_DATA-acc-exhausted";
  request.event_id = "evidence_event:acc-exhausted";
  const result = controlPlane.enforceScopedAccess(exhausted, request);
  assertDenied(result, "access_event_not_appendable");
}

function testSchemaBackstopsAreReachable(controlPlane, fixtures) {
  // Shapes that no targeted guard catches, so only the schema backstop can
  // reject them. If a backstop were deleted, these would pass.
  assertRejectedWith(
    controlPlane.classifyStoredObject({ ...fixtures.evidenceArtifact, stored_object_ref: "not-a-ref" }),
    "stored_object_schema_invalid"
  );

  const { actor: _actor, ...withoutActor } = fixtures.retentionStatus;
  assertRejectedWith(controlPlane.appendEvidenceLifecycleEvent([], withoutActor), "evidence_event_schema_invalid");

  assertRejectedWith(
    controlPlane.buildEvidenceMinimizationProjection(
      {
        ...fixtures.minimization,
        entries: [{ ...fixtures.minimization.entries[0], artifact_ref: "NOT A REF" }]
      },
      [fixtures.deletionEvidence]
    ),
    "minimization_projection_schema_invalid"
  );

  assertRejectedWith(
    controlPlane.recordOptInRetention(
      { ...fixtures.optInRecord, retained_artifact_refs: [] },
      "partner_pilot_real_snippet_ready"
    ),
    "retention_opt_in_schema_invalid"
  );
}

/** The purity scan is only a guarantee if it actually bites. */
function testSourceScanCatchesForbiddenForms() {
  const mustCatch = [
    'import fs from "fs";',
    'import { readFile } from "node:fs/promises";',
    'const cp = require("child_process");',
    'await import("node:net");',
    'const response = await fetch("https://example.test");',
    'import express from "express";',
    'import { Firestore } from "@google-cloud/firestore";',
    'import pg from "pg";',
    'import Redis from "ioredis";'
  ];
  for (const sample of mustCatch) {
    assert(
      FORBIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(sample)),
      `the purity scan must catch: ${sample}`
    );
  }

  const mustNotCatch = [
    "// a regular expression over the entries",
    "const thumbnail = name.endsWith('.jpg');",
    "// express the invariant clearly",
    "const location = entry.path;",
    "// compress and redirect are ordinary words"
  ];
  for (const sample of mustNotCatch) {
    assert(
      !FORBIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(sample)),
      `the purity scan must not fire on ordinary prose: ${sample}`
    );
  }
}

function accessRequest(fixtures) {
  return {
    actor: fixtures.accessed.actor,
    role: "codeattest_reviewer",
    tenant_id: fixtures.accessed.access_scope.tenant_id,
    review_scope: fixtures.accessed.review_id,
    artifact: {
      artifact_ref: fixtures.accessed.artifact_refs[0],
      tenant_id: fixtures.accessed.access_scope.tenant_id,
      review_scope: fixtures.accessed.review_id,
      source_derived_class: fixtures.accessed.source_derived_class
    },
    event_id: fixtures.accessed.event_id,
    idempotency_key: fixtures.accessed.idempotency_key,
    event_timestamp: fixtures.accessed.event_timestamp,
    purpose: fixtures.accessed.purpose
  };
}

function deletedEntry(fixtures) {
  const entry = fixtures.minimization.entries.find((candidate) => candidate.minimization_category === "deleted_transient");
  assert(entry !== undefined, "the minimization fixture must contain a deleted_transient entry");
  return { ...entry };
}

async function readValidFixture(fileName) {
  return JSON.parse(await readFile(path.join(validFixtureRoot, fileName), "utf8"));
}

async function collectTypeScriptSources(directory) {
  const collected = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...await collectTypeScriptSources(absolutePath));
    } else if (entry.isFile() && absolutePath.endsWith(".ts")) {
      collected.push(absolutePath);
    }
  }
  return collected.sort();
}

function assertRejectedWith(result, expectedReason) {
  assert(result.outcome === "rejected", `expected rejection ${expectedReason}; got ${JSON.stringify(result)}`);
  assert(result.reason === expectedReason, `expected reason ${expectedReason}; got ${result.reason}`);
}

function assertDenied(result, expectedReason) {
  assert(result.decision === "denied", `expected denial ${expectedReason}; got ${JSON.stringify(result)}`);
  assert(result.reason === expectedReason, `expected reason ${expectedReason}; got ${result.reason}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
