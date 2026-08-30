import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compileWorkspace as compileIdentity } from "../../../../packages/identity-store/test/helpers/compile.mjs";
import { verifiedOutcome } from "../../../../packages/protocol-ts/test/helpers/real-signature.mjs";
import { compileWorkspace, importCompiled } from "./compile.mjs";

const {
  hashSecret,
  mintTotpSecret,
  mintSessionToken,
  openTotpSecret,
  sealTotpSecret,
  totpCodeAt,
  createMemoryAccountStore,
  createMemorySessionStore,
  createMemoryLoginThrottle,
  SESSION_ABSOLUTE_LIFETIME_MS
} = await compileIdentity("index.js");

const totpKey = randomBytes(32);
const reviewerTotp = mintTotpSecret();
const reviewerBox = sealTotpSecret(reviewerTotp.secret, totpKey);
const reviewerOpened = openTotpSecret(reviewerBox, totpKey);
if (reviewerOpened === undefined) {
  throw new Error("fixture TOTP box failed to open");
}

const TENANT_ID = "tenant-synthetic-demo";
const OTHER_TENANT_ID = "tenant-synthetic-other";

export const SEEDED = {
  customer: {
    identifier: "customer@synthetic.invalid",
    password: "synthetic-customer-password",
    account_id: "account:synthetic-customer",
    tenant_id: TENANT_ID
  },
  reviewer: {
    identifier: "reviewer@synthetic.invalid",
    password: "synthetic-reviewer-password",
    account_id: "account:synthetic-reviewer",
    tenant_id: TENANT_ID,
    totpBase32: reviewerTotp.base32,
    currentTotpCode: () => totpCodeAt(reviewerOpened, Math.floor(Date.now() / 1000))
  },
  locked: {
    identifier: "locked@synthetic.invalid",
    password: "synthetic-locked-password",
    account_id: "account:synthetic-locked",
    tenant_id: TENANT_ID
  },
  dualRole: {
    identifier: "dual@synthetic.invalid",
    password: "synthetic-dual-password",
    account_id: "account:synthetic-dual",
    tenant_id: TENANT_ID
  },
  scopedCustomer: {
    identifier: "scoped@synthetic.invalid",
    password: "synthetic-scoped-password",
    account_id: "account:synthetic-scoped",
    tenant_id: TENANT_ID
  },
  artifactRefInScope: "artifact_ref:synthetic_in_scope",
  reviewInScope: "review:synthetic-demo-0001",
  reviewRejected: "review:synthetic-demo-0002",
  artifactRefOtherTenant: "artifact_ref:synthetic_other_tenant",
  reviewOutOfScope: "review:synthetic-other-0001",
  otherTenantId: OTHER_TENANT_ID,
  pendingCookie: "",
  submissionSecret: "synthetic-demo-submission-secret"
};

function setCookie(headers) {
  const value = headers["set-cookie"];
  return Array.isArray(value) ? value[0] : value;
}

export async function loginAs(server, seededAccount) {
  const response = await server.inject({
    method: "POST",
    url: "/v0/auth/login",
    payload: { identifier: seededAccount.identifier, secret: seededAccount.password }
  });
  const cookie = setCookie(response.headers);
  if (typeof cookie !== "string") {
    throw new Error(`loginAs: no session cookie (${response.statusCode} ${response.body})`);
  }
  if (response.statusCode === 204) {
    return cookie;
  }
  if (response.statusCode === 202 && typeof seededAccount.currentTotpCode === "function") {
    const upgraded = await server.inject({
      method: "POST",
      url: "/v0/auth/login/second-factor",
      headers: { cookie },
      payload: { code: seededAccount.currentTotpCode() }
    });
    const satisfied = setCookie(upgraded.headers);
    if (typeof satisfied !== "string") {
      throw new Error(`loginAs: second factor issued no cookie (${upgraded.statusCode} ${upgraded.body})`);
    }
    return satisfied;
  }
  throw new Error(`loginAs: unexpected status ${response.statusCode} ${response.body}`);
}

function digestOf(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function classificationFor(digest) {
  return {
    protocol_version: "codeattest.v0",
    stored_object_ref: `stored_object:${digest.replace(/^sha256:/, "")}`,
    object_kind: "evidence_artifact",
    source_derived_class: "retained_review_artifact",
    environment_profile: "synthetic_demo"
  };
}

function reviewEventFor(reviewId, eventType, idFiller) {
  return {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${idFiller.repeat(64).slice(0, 64)}`,
    review_id: reviewId,
    sequence_number: 0,
    idempotency_key: `${eventType}:${reviewId}`,
    event_type: eventType,
    actor: { actor_type: "vendor_service", actor_id: "vendor_service:codeattest-intake" },
    event_timestamp: "2026-08-16T00:00:00Z",
    artifact_refs: ["artifact_ref:vendor_receipt"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"]
  };
}

async function importEvidenceStore() {
  const dir = await compileWorkspace();
  return import(pathToFileURL(path.join(dir, "packages", "evidence-store", "src", "index.js")).href);
}

async function importProtocolTs() {
  const dir = await compileWorkspace();
  return import(pathToFileURL(path.join(dir, "packages", "protocol-ts", "src", "index.js")).href);
}

function loadValidFixture(name) {
  const fixturePath = fileURLToPath(new URL(`../../../../protocol/fixtures/v0/valid/${name}`, import.meta.url));
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

/**
 * Assembles a schema-valid review event and fills its content-addressed
 * `event_id`, so `buildReviewHistoryTimeline` accepts the seeded log (the
 * placeholder-id events elsewhere are enough for state derivation but a real
 * timeline validates identity).
 */
function makeReviewEvent(protocolTs, reviewId, seq, fields) {
  const event = {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: reviewId,
    sequence_number: seq,
    idempotency_key: fields.idempotency_key,
    event_type: fields.event_type,
    actor: fields.actor,
    event_timestamp: fields.event_timestamp ?? "2026-07-19T00:00:00Z",
    artifact_refs: fields.artifact_refs,
    visibility: fields.visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    ...(fields.internal_note === undefined ? {} : { internal_note: fields.internal_note })
  };
  const identity = protocolTs.recomputeExcludedFieldsIdentity(event, ["event_id"]);
  if (identity === undefined) {
    throw new Error(`failed to compute review event identity for ${fields.event_type}`);
  }
  event.event_id = identity;
  return event;
}

/**
 * In-process Fastify host with memory identity adapters and three seeded
 * accounts. Default cookie flag is Secure so the cookie name is
 * `__Host-codeattest_session`.
 */
export async function buildTestServer(options = {}) {
  const { createServer } = await importCompiled("src/server.js");
  const { registerAuthRoutes } = await importCompiled("src/routes/auth.js");
  const { registerWebRoutes } = await importCompiled("src/routes/web.js");
  const { registerActorResolution } = await importCompiled("src/auth/resolve-actor.js");
  const { requireEvidenceAccess } = await importCompiled("src/auth/require-evidence-access.js");
  const { errorEnvelope } = await importCompiled("src/error-envelope.js");
  const { serializeSessionCookie } = await importCompiled("src/auth/cookie.js");
  const { createMemoryReviewRecordStore } = await importCompiled("src/web/record-store.js");
  const evidenceStore = await importEvidenceStore();
  const protocolTs = await importProtocolTs();

  const accounts = createMemoryAccountStore();
  const sessions = createMemorySessionStore();
  const throttle = createMemoryLoginThrottle();
  const evidenceLifecycleLog = evidenceStore.createMemoryEvidenceLifecycleLogStore();
  const reviewEventLog = evidenceStore.createMemoryReviewEventLogStore();
  const artifacts = evidenceStore.createMemoryArtifactStore(evidenceLifecycleLog);
  const records = createMemoryReviewRecordStore();

  await accounts.seed({
    tenant: { tenant_id: TENANT_ID, display_name: "SYNTHETIC_DEMO_DATA tenant" },
    account: {
      account_id: SEEDED.customer.account_id,
      tenant_id: TENANT_ID,
      identifier: SEEDED.customer.identifier,
      secret_hash: hashSecret(SEEDED.customer.password),
      totp_secret_box: null
    },
    grants: [{ account_id: SEEDED.customer.account_id, role: "customer_viewer", review_scope: null }]
  });
  await accounts.seed({
    tenant: { tenant_id: TENANT_ID, display_name: "SYNTHETIC_DEMO_DATA tenant" },
    account: {
      account_id: SEEDED.reviewer.account_id,
      tenant_id: TENANT_ID,
      identifier: SEEDED.reviewer.identifier,
      secret_hash: hashSecret(SEEDED.reviewer.password),
      totp_secret_box: reviewerBox
    },
    grants: [{ account_id: SEEDED.reviewer.account_id, role: "codeattest_reviewer", review_scope: null }]
  });
  await accounts.seed({
    tenant: { tenant_id: TENANT_ID, display_name: "SYNTHETIC_DEMO_DATA tenant" },
    account: {
      account_id: SEEDED.locked.account_id,
      tenant_id: TENANT_ID,
      identifier: SEEDED.locked.identifier,
      secret_hash: hashSecret(SEEDED.locked.password),
      totp_secret_box: null
    },
    grants: [{ account_id: SEEDED.locked.account_id, role: "customer_viewer", review_scope: null }]
  });
  await accounts.seed({
    tenant: { tenant_id: TENANT_ID, display_name: "SYNTHETIC_DEMO_DATA tenant" },
    account: {
      account_id: SEEDED.dualRole.account_id,
      tenant_id: TENANT_ID,
      identifier: SEEDED.dualRole.identifier,
      secret_hash: hashSecret(SEEDED.dualRole.password),
      totp_secret_box: null
    },
    grants: [
      { account_id: SEEDED.dualRole.account_id, role: "codeattest_reviewer", review_scope: null },
      { account_id: SEEDED.dualRole.account_id, role: "customer_viewer", review_scope: SEEDED.reviewInScope }
    ]
  });
  await accounts.seed({
    tenant: { tenant_id: TENANT_ID, display_name: "SYNTHETIC_DEMO_DATA tenant" },
    account: {
      account_id: SEEDED.scopedCustomer.account_id,
      tenant_id: TENANT_ID,
      identifier: SEEDED.scopedCustomer.identifier,
      secret_hash: hashSecret(SEEDED.scopedCustomer.password),
      totp_secret_box: null
    },
    grants: [
      { account_id: SEEDED.scopedCustomer.account_id, role: "customer_viewer", review_scope: SEEDED.reviewInScope },
      { account_id: SEEDED.scopedCustomer.account_id, role: "customer_viewer", review_scope: SEEDED.reviewRejected }
    ]
  });

  const seededArtifacts = new Map();
  const inScopeBytes = new TextEncoder().encode("SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE in-scope");
  const otherBytes = new TextEncoder().encode("SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE other-tenant");
  const inScope = {
    artifact_ref: SEEDED.artifactRefInScope,
    tenant_id: TENANT_ID,
    review_scope: SEEDED.reviewInScope,
    source_derived_class: "retained_review_artifact",
    digest: digestOf(inScopeBytes),
    bytes: inScopeBytes
  };
  const otherTenant = {
    artifact_ref: SEEDED.artifactRefOtherTenant,
    tenant_id: OTHER_TENANT_ID,
    review_scope: SEEDED.reviewOutOfScope,
    source_derived_class: "retained_review_artifact",
    digest: digestOf(otherBytes),
    bytes: otherBytes
  };
  seededArtifacts.set(inScope.artifact_ref, inScope);
  seededArtifacts.set(otherTenant.artifact_ref, otherTenant);
  const inScopeEvents = [
    makeReviewEvent(protocolTs, SEEDED.reviewInScope, 0, {
      event_type: "receipt_issued",
      visibility: "customer_facing",
      actor: { actor_type: "vendor_service", actor_id: "SYNTHETIC_DEMO_DATA-intake-service" },
      artifact_refs: ["artifact_ref:vendor_receipt_inscope", "artifact_ref:evidence_bundle_inscope"],
      idempotency_key: `receipt:${SEEDED.reviewInScope}`,
      reason: "SYNTHETIC_DEMO_DATA receipt issued. NOT_CUSTOMER_SOURCE."
    }),
    makeReviewEvent(protocolTs, SEEDED.reviewInScope, 1, {
      event_type: "classification_recorded",
      visibility: "internal_only",
      actor: { actor_type: "reviewer", actor_id: "SYNTHETIC_DEMO_DATA-reviewer-1" },
      artifact_refs: ["artifact_ref:finding_inscope"],
      idempotency_key: `classification:${SEEDED.reviewInScope}:finding_inscope`,
      internal_note: "NOT_CUSTOMER_SOURCE reviewer classification rationale"
    }),
    makeReviewEvent(protocolTs, SEEDED.reviewInScope, 2, {
      event_type: "customer_remediation_recorded",
      visibility: "customer_facing",
      actor: { actor_type: "customer_user", actor_id: "SYNTHETIC_DEMO_DATA-customer-1" },
      artifact_refs: ["artifact_ref:finding_inscope"],
      idempotency_key: `customer_remediation:${SEEDED.reviewInScope}:finding_inscope`,
      reason: "NOT_CUSTOMER_SOURCE customer recorded a remediation"
    })
  ];
  for (const event of inScopeEvents) {
    const appended = await reviewEventLog.append(SEEDED.reviewInScope, event);
    if (appended.outcome === "rejected") {
      throw new Error(`seed in-scope review log failed: ${appended.reason}`);
    }
  }
  const rejectedLog = await reviewEventLog.append(
    SEEDED.reviewRejected,
    reviewEventFor(SEEDED.reviewRejected, "submission_rejected", "c")
  );
  if (rejectedLog.outcome === "rejected") {
    throw new Error(`seed rejected review log failed: ${rejectedLog.reason}`);
  }
  // C3: exercise the production synthetic-demo seed path
  // (services/host's seedSyntheticDemoReviewRecords) instead of duplicating the
  // seed here, so the web-route tests below double as its acceptance coverage. A
  // stub verifier stands in for a trusted key directory so the static-bundle
  // sub-view renders; in production that one panel fail-closes when the shipped
  // fixture directory is not trusted.
  const { seedSyntheticDemoReviewRecords } = await importCompiled("src/web/seed-record-store.js");
  seedSyntheticDemoReviewRecords(records, {
    fixturesRoot: fileURLToPath(new URL("../../../../protocol/fixtures/v0", import.meta.url)),
    verifier: {
      directoryTrusted: true,
      verify: ({ envelope, verified_at }) => verifiedOutcome(envelope, { verified_at })
    },
    verifiedAt: "2026-08-16T00:00:00Z"
  });
  const outOfScopeLog = await reviewEventLog.append(
    SEEDED.reviewOutOfScope,
    reviewEventFor(SEEDED.reviewOutOfScope, "submission_rejected", "b")
  );
  if (outOfScopeLog.outcome === "rejected") {
    throw new Error(`seed out-of-scope review log failed: ${outOfScopeLog.reason}`);
  }
  await artifacts.put({
    digest: inScope.digest,
    bytes: inScope.bytes,
    classification: classificationFor(inScope.digest),
    reviewId: inScope.review_scope
  });
  await artifacts.put({
    digest: otherTenant.digest,
    bytes: otherTenant.bytes,
    classification: classificationFor(otherTenant.digest),
    reviewId: otherTenant.review_scope
  });

  const pendingMinted = mintSessionToken();
  const issuedAt = new Date();
  await sessions.issue({
    session_handle: pendingMinted.handle,
    account_id: SEEDED.reviewer.account_id,
    issued_at: issuedAt,
    absolute_expires_at: new Date(issuedAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS),
    second_factor_state: "pending"
  });
  SEEDED.pendingCookie = serializeSessionCookie(pendingMinted.token, {
    secure: true,
    maxAgeSeconds: SESSION_ABSOLUTE_LIFETIME_MS / 1000
  });

  const nowUtcRfc3339 = options.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const server = createServer(
    options.logger === undefined
      ? { isReady: () => true }
      : { isReady: () => true, logger: options.logger }
  );
  server.decorate("ports", { evidenceLifecycleLog, reviewEventLog, records });
  server.decorate("now", nowUtcRfc3339);
  registerActorResolution(server, {
    accounts,
    sessions,
    sessionCookieSecure: true
  });
  await registerWebRoutes(server, { errorEnvelope });
  await registerAuthRoutes(server, {
    accounts,
    sessions,
    throttle,
    totpKey,
    sessionCookieSecure: true,
    errorEnvelope
  });
  server.get("/test/evidence/:ref", async (request, reply) => {
    const artifact = seededArtifacts.get(request.params.ref);
    if (artifact === undefined) {
      return reply.code(404).send(errorEnvelope("evidence_access_denied"));
    }
    const access = await requireEvidenceAccess(request, {
      artifact: {
        artifact_ref: artifact.artifact_ref,
        tenant_id: artifact.tenant_id,
        review_scope: artifact.review_scope,
        source_derived_class: artifact.source_derived_class
      },
      purpose: "customer_review_read",
      idempotencyScope: "test_evidence_artifact"
    });
    if ("denied" in access) {
      if (access.denied === "unauthenticated") {
        return reply.code(401).send(errorEnvelope("auth_credentials_invalid"));
      }
      return reply.code(403).send(errorEnvelope("evidence_access_denied"));
    }
    const read = await artifacts.get({ access, digest: artifact.digest });
    if (read.outcome !== "read") {
      return reply.code(404).send(errorEnvelope("evidence_access_denied"));
    }
    return reply.code(200).send(Buffer.from(read.bytes));
  });
  await server.ready();
  return { server, ports: { accounts, sessions, throttle, totpKey, evidenceLifecycleLog, reviewEventLog, artifacts, records } };
}
