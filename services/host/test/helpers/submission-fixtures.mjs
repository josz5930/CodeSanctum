import { createHash, scryptSync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import canonicalizeJson from "canonicalize";

import { compileWorkspace as compileIdentity } from "../../../../packages/identity-store/test/helpers/compile.mjs";
import { compileWorkspace, importCompiled } from "./compile.mjs";
import { directory, keyRecord, TEST_LIMITATIONS } from "../../../../packages/signing/test/helpers/test-directory.mjs";

const workspacePath = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const validFixtureRoot = path.join(fixtureRoot, "v0", "valid");

export const AUTH_HEADER = "Bearer demo-runner-key-1:synthetic-demo-submission-secret";
const CREDENTIAL_SECRET = "synthetic-demo-submission-secret";
export const REVIEW_ID = "review:synthetic-demo-0001";
const HOST_SIGNING_KEY_ID = "codeattest-demo-signing-key";
const HOST_SIGNING_KEY_VERSION = "v1";
const RUNNER_KEY_ID = "codeattest-runner-test-key";
const RUNNER_KEY_VERSION = "v1";
const SYNTHETIC_OBJECT_ENVELOPE = {
  keyId: "synthetic-host-route-test-envelope",
  key: Uint8Array.from({ length: 32 }, (_, index) => index)
};
export const BUNDLE_IDENTITY_INPUT_PATH = "v0/valid/bundle-manifest.identity-input.json";

const RUNNER_SIGNING_LIMITATIONS = [
  "Key custody is customer-held runner custody; the private key is generated on this machine and never transmitted.",
  "The runner is open source and runs on the customer's own machine, so this signature cannot attest that the runner code was unmodified."
];

async function importSibling(pkgSegments, relativePath) {
  const dir = await compileWorkspace();
  return import(pathToFileURL(path.join(dir, ...pkgSegments, relativePath)).href);
}

async function fixtureJson(name) {
  return JSON.parse(await readFile(path.join(validFixtureRoot, name), "utf8"));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalIdentity(value, excludedField) {
  const clone = JSON.parse(JSON.stringify(value));
  delete clone[excludedField];
  const text = canonicalizeJson(clone);
  if (typeof text !== "string") {
    throw new Error("canonicalization failed");
  }
  return digestBytes(Buffer.from(text));
}

const ARTIFACT_COUNT_CATEGORIES = [
  "metadata",
  "dependencies",
  "scanner_findings",
  "raw_snippets",
  "targeted_files",
  "derived_artifacts",
  "never_collected_items"
];

export function artifactCountSummaryFromManifest(manifest) {
  const categories = ARTIFACT_COUNT_CATEGORIES.map((category) => {
    const found = manifest.evidence_categories.find((entry) => entry.category === category);
    return { category, count: found?.count ?? 0 };
  });
  return {
    count_domain: "evidence_category_counts",
    total_count: categories.reduce((sum, entry) => sum + entry.count, 0),
    categories
  };
}

function hashCredentialSecret(secret) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, Buffer.from(salt, "hex"), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
  return `scrypt$32768$8$1$${salt}$${hash}`;
}

let cached;

/**
 * Builds every synthetic fixture this test suite needs exactly once: real
 * ML-DSA-65 key material for both the deployment's own managed signing key
 * and a stand-in "enrolled runner" key (registered in the same trust-anchor-
 * signed key directory, mirroring D2's custody model), plus a fully
 * cross-referenced bundle manifest / outbound manifest / customer approval
 * derived from the committed protocol fixtures on disk -- so a protocol
 * change cannot leave this helper stale.
 */
async function buildFixtures() {
  if (cached !== undefined) {
    return cached;
  }

  const signing = await importSibling(["packages", "signing"], "src/index.js");
  const managed = signing.generateMlDsa65KeyPair();
  const runner = signing.generateMlDsa65KeyPair();
  const anchor = signing.generateMlDsa65KeyPair();

  const keyDirectory = directory([
    keyRecord({
      key_id: HOST_SIGNING_KEY_ID,
      key_version: HOST_SIGNING_KEY_VERSION,
      public_key: signing.encodeBase64Url(managed.publicKey),
      custody_mode: "self_hosted_software"
    }),
    keyRecord({
      key_id: RUNNER_KEY_ID,
      key_version: RUNNER_KEY_VERSION,
      public_key: signing.encodeBase64Url(runner.publicKey),
      custody_mode: "customer_held_runner"
    })
  ]);
  keyDirectory.directory_signature = signing.signIdentityEnvelope({
    signing_input: signing.keyDirectorySigningInput(keyDirectory),
    key: { key_id: "codeattest-demo-trust-anchor", key_version: "v1", privateKeyPkcs8: anchor.privateKeyPkcs8 },
    signing_time: "2026-01-01T00:00:00Z",
    signing_mode: "managed_key",
    signing_limitations: [...TEST_LIMITATIONS]
  });

  const { createKeyService } = await importSibling(["services", "host"], "src/signing/key-service.js");
  const keyService = createKeyService({
    key: { key_id: HOST_SIGNING_KEY_ID, key_version: HOST_SIGNING_KEY_VERSION, privateKeyPkcs8: managed.privateKeyPkcs8 },
    directory: keyDirectory,
    trustAnchorPublicKey: anchor.publicKey
  });

  const bundleManifest = await fixtureJson("bundle-manifest.json");
  const approvedOutboundManifest = await fixtureJson("outbound-manifest.json");
  const customerApproval = await fixtureJson("customer-approval.approved.json");

  bundleManifest.runner.version = approvedOutboundManifest.runner.version;
  const expectedManifestId = canonicalIdentity(approvedOutboundManifest, "manifest_id");
  if (approvedOutboundManifest.manifest_id !== expectedManifestId) {
    throw new Error("fixture outbound-manifest.json manifest_id does not match its own canonical identity");
  }
  customerApproval.manifest_id = approvedOutboundManifest.manifest_id;
  customerApproval.displayed_context.manifest_id = approvedOutboundManifest.manifest_id;
  bundleManifest.manifest_id = approvedOutboundManifest.manifest_id;
  bundleManifest.verification_metadata.approved_manifest_id = approvedOutboundManifest.manifest_id;

  const artifactBytesByDigest = {};
  const artifactBytesByRef = {};
  for (const reference of bundleManifest.artifact_references) {
    if (typeof reference.content_path === "string") {
      const bytes = await readFile(path.join(fixtureRoot, reference.content_path));
      reference.digest = digestBytes(bytes);
      reference.size_bytes = bytes.byteLength;
      artifactBytesByDigest[reference.digest] = bytes;
      artifactBytesByRef[reference.artifact_ref] = bytes;
    }
  }
  bundleManifest.evidence_bundle_id = canonicalIdentity(bundleManifest, "evidence_bundle_id");

  const signatureEnvelope = signing.signIdentityEnvelope({
    signing_input: {
      protocol_version: "codeattest.v0",
      signing_input_type: "evidence_bundle_identity",
      algorithm_profile: "ml_dsa_65",
      signed_identity_type: "evidence_bundle",
      signed_identity: bundleManifest.evidence_bundle_id,
      canonicalization: "rfc8785",
      identity_input_path: BUNDLE_IDENTITY_INPUT_PATH
    },
    key: { key_id: RUNNER_KEY_ID, key_version: RUNNER_KEY_VERSION, privateKeyPkcs8: runner.privateKeyPkcs8 },
    signing_time: "2026-06-01T00:00:00Z",
    signing_mode: "enrolled_runner_key",
    signing_limitations: [...RUNNER_SIGNING_LIMITATIONS]
  });

  const credential = {
    token_key_id: "demo-runner-key-1",
    review_id: REVIEW_ID,
    tenant_id: "tenant-synthetic-demo",
    customer_id: "customer-synthetic-demo",
    selected_application_id: approvedOutboundManifest.selected_scope_summary.selected_application.application_id,
    selected_commit: approvedOutboundManifest.selected_scope_summary.selected_commit.commit_sha,
    repository_identity_hash: approvedOutboundManifest.selected_scope_summary.repository_identity,
    expected_manifest_id: approvedOutboundManifest.manifest_id,
    expected_evidence_bundle_id: bundleManifest.evidence_bundle_id,
    secret_hash: hashCredentialSecret(CREDENTIAL_SECRET)
  };

  cached = {
    keyDirectory,
    trustAnchorPublicKey: anchor.publicKey,
    keyService,
    bundleManifest,
    approvedOutboundManifest,
    customerApproval,
    signatureEnvelope,
    artifactBytesByDigest,
    artifactBytesByRef,
    credential
  };
  return cached;
}

export async function syntheticCredential() {
  const fixtures = await buildFixtures();
  return { ...fixtures.credential };
}

export async function syntheticGate() {
  return fixtureJson("environment-evidence-gate.synthetic-demo.json");
}

export async function testKeyService() {
  const fixtures = await buildFixtures();
  return fixtures.keyService;
}

export async function syntheticBundle() {
  const fixtures = await buildFixtures();
  return {
    bundle_manifest: structuredClone(fixtures.bundleManifest),
    signature_envelope: structuredClone(fixtures.signatureEnvelope),
    customer_approval: structuredClone(fixtures.customerApproval),
    approved_outbound_manifest: structuredClone(fixtures.approvedOutboundManifest),
    artifact_bytes_by_digest: fixtures.artifactBytesByDigest,
    artifact_bytes_by_ref: fixtures.artifactBytesByRef
  };
}

/**
 * Builds an in-process Fastify server with memory adapters (or the supplied
 * Postgres pool + filesystem object store root) wired to a single credential
 * matching `AUTH_HEADER`. `server.inject` drives it, so no port is bound.
 */
export async function buildTestServer(options = {}) {
  const fixtures = await buildFixtures();
  const { createServer } = await importCompiled("src/server.js");
  const { registerSubmissionRoutes } = await importCompiled("src/routes/submissions.js");
  const { errorEnvelope } = await importCompiled("src/error-envelope.js");
  const { createMemorySubmissionCredentialStore } = await compileIdentity("memory/submission-credential-store.js");
  const { createConfigBudgetMeter } = await importCompiled("src/submission/budget-meter.js");
  const { createMemorySubmissionAttemptStore, createPostgresSubmissionAttemptStore } = await importCompiled("src/submission/attempt-state.js");
  const { createSubmissionAccessMinter } = await importCompiled("src/submission/access.js");
  const { createSubmissionReviewEventAppender } = await importCompiled("src/submission/review-events.js");

  const evidenceStore = await importSibling(["packages", "evidence-store"], "src/index.js");

  const server = createServer(
    options.logger === undefined
      ? { isReady: () => true }
      : { isReady: () => true, logger: options.logger }
  );
  const now = () => "2026-08-16T12:00:00Z";
  const issuedAt = new Date("2026-08-16T12:00:00Z");
  const credentials = createMemorySubmissionCredentialStore();
  await credentials.issue({
    ...fixtures.credential,
    issued_at: issuedAt,
    expires_at: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
  });

  let deps;
  if (options.pool !== undefined) {
    const objects = evidenceStore.createFilesystemObjectStore(options.objectStoreRoot);
    const evidenceLifecycleLog = evidenceStore.createPostgresEvidenceLifecycleLogStore(options.pool);
    const reviewEventLog = evidenceStore.createPostgresReviewEventLogStore(options.pool);
    deps = {
      credentials,
      attempts: createPostgresSubmissionAttemptStore(options.pool),
      artifacts: evidenceStore.createPostgresArtifactStore({
        sql: options.pool,
        objects,
        lifecycleLog: evidenceLifecycleLog,
        envelope: SYNTHETIC_OBJECT_ENVELOPE
      }),
      classifications: evidenceStore.createPostgresClassificationStore(options.pool),
      reviewEventLog,
      evidenceLifecycleLog,
      jobs: evidenceStore.createPostgresJobQueue(options.pool),
      budget: options.budget ?? createConfigBudgetMeter({ demo_budget: { spend_ratio: options.spendRatio ?? 0.1 } }),
      boundGate: await syntheticGate(),
      keyService: fixtures.keyService,
      errorEnvelope,
      now
    };
    deps.mintSubmissionAccess = createSubmissionAccessMinter(evidenceLifecycleLog, now);
    deps.appendSubmissionReviewEvent = createSubmissionReviewEventAppender(reviewEventLog);
  } else {
    const evidenceLifecycleLog = evidenceStore.createMemoryEvidenceLifecycleLogStore();
    const reviewEventLog = evidenceStore.createMemoryReviewEventLogStore();
    deps = {
      credentials,
      attempts: createMemorySubmissionAttemptStore(),
      artifacts: evidenceStore.createMemoryArtifactStore(evidenceLifecycleLog, {
        envelope: SYNTHETIC_OBJECT_ENVELOPE
      }),
      classifications: evidenceStore.createMemoryClassificationStore(),
      reviewEventLog,
      evidenceLifecycleLog,
      jobs: evidenceStore.createMemoryJobQueue(),
      budget: options.budget ?? createConfigBudgetMeter({ demo_budget: { spend_ratio: options.spendRatio ?? 0.1 } }),
      boundGate: await syntheticGate(),
      keyService: fixtures.keyService,
      errorEnvelope,
      now
    };
    deps.mintSubmissionAccess = createSubmissionAccessMinter(evidenceLifecycleLog, now);
    deps.appendSubmissionReviewEvent = createSubmissionReviewEventAppender(reviewEventLog);
  }

  if (options.slowdown !== undefined) {
    deps.slowdown = options.slowdown;
  }

  await registerSubmissionRoutes(server, deps);
  await server.ready();
  return { server, deps };
}
