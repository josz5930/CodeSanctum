import { createHash } from "node:crypto";

import type { FastifyError, FastifyInstance } from "fastify";
import canonicalizeJson from "canonicalize";

import { validateProtocolSchema, type StoredObjectClassification } from "../../../../packages/protocol-ts/src/index.js";
import { buildSubmissionOutcome, completeVendorReceipt, prepareVendorReceipt, verifyIntakeSubmission } from "../../../../services/intake/src/index.js";
import { MANAGED_KEY_LIMITATIONS } from "../signing/key-service.js";
import { artifactCountSummaryFromManifest, assembleIntakeRequest, submissionOutcomeIdFor } from "../submission/assemble-intake-request.js";
import { budgetTierFor } from "../submission/budget-tiers.js";
import { classifyStoredObject } from "../submission/classify.js";
import { verifyCredentialSecret, type SubmissionCredential } from "../submission/credential-store.js";
import type { SubmissionRouteDeps } from "./types.js";

/** Fastify's default bodyLimit (1 MiB) is smaller than a real bundle artifact. */
const ARTIFACT_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export type BudgetHaltGuardDeps = Pick<SubmissionRouteDeps, "budget" | "errorEnvelope"> & {
  deploymentIdentity: "demo" | "pilot";
};

function isBusinessRequest(url: string): boolean {
  const path = url.split("?", 1)[0];
  return path === "/v0" || path?.startsWith("/v0/") === true || path === "/web" || path?.startsWith("/web/") === true;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const SCHEMA_BY_PART = {
  bundle_manifest: "urn:codeattest:protocol:v0:bundle-manifest",
  signature_envelope: "urn:codeattest:protocol:v0:signature-envelope",
  customer_approval: "urn:codeattest:protocol:v0:customer-approval",
  approved_outbound_manifest: "urn:codeattest:protocol:v0:outbound-manifest"
} as const;

export function parseSubmissionCredentialHeader(header: string | undefined): { tokenKeyId: string; secret: string } | undefined {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return undefined;
  }
  const raw = header.slice("Bearer ".length);
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator === raw.length - 1) {
    return undefined;
  }
  return { tokenKeyId: raw.slice(0, separator), secret: raw.slice(separator + 1) };
}

/**
 * `stored_object_ref` must match `^stored_object:[a-z0-9][a-z0-9_-]{2,63}$`,
 * so the digest's hex body is used without its `sha256:` prefix.
 */
export function storedObjectRefFor(digest: string): string {
  return `stored_object:${digest.replace(/^sha256:/, "")}`;
}

/**
 * Every authentication failure returns the same reason code so a caller
 * cannot enumerate valid key ids. The secret comparison always runs, even
 * against an unknown key id, so response timing does not distinguish
 * "no such key" from "wrong secret".
 */
async function authenticate(
  presented: { tokenKeyId: string; secret: string } | undefined,
  deps: SubmissionRouteDeps
): Promise<SubmissionCredential | undefined> {
  if (presented === undefined) {
    return undefined;
  }
  const credential = await deps.credentials.resolve(presented.tokenKeyId, new Date(deps.now()));
  const secretOk = credential !== undefined && verifyCredentialSecret(credential, presented.secret);
  return credential !== undefined && secretOk ? credential : undefined;
}

function canonical(value: unknown): string {
  const text = canonicalizeJson(value);
  if (typeof text !== "string") {
    throw new Error("canonicalization failed");
  }
  return text;
}

/**
 * Demo spend at the full ceiling halts business traffic without taking down
 * liveness/readiness. Pilot never evaluates the demo meter, so the two
 * deployment identities cannot couple their availability through this hook.
 */
export function registerBudgetHaltGuard(server: FastifyInstance, deps: BudgetHaltGuardDeps): void {
  server.addHook("preHandler", async (request, reply) => {
    if (deps.deploymentIdentity !== "demo" || !isBusinessRequest(request.url)) {
      return;
    }
    const spendRatio = await deps.budget.spendRatio();
    if (spendRatio < 1) {
      return;
    }
    request.log.warn({
      event: "budget_halted",
      deployment_identity: deps.deploymentIdentity,
      spend_ratio: spendRatio
    }, "demo business routes halted at budget ceiling");
    return reply.code(503).send(deps.errorEnvelope("budget_halted"));
  });
}

export async function registerSubmissionRoutes(server: FastifyInstance, deps: SubmissionRouteDeps): Promise<void> {
  server.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      reply.code(413).send(deps.errorEnvelope("submission_artifact_too_large"));
      return;
    }
    reply.send(error);
  });

  server.post("/v0/submissions", async (request, reply) => {
    const credential = await authenticate(parseSubmissionCredentialHeader(request.headers.authorization), deps);
    if (credential === undefined) {
      return reply.code(401).send(deps.errorEnvelope("submission_credential_invalid"));
    }

    const spendRatio = await deps.budget.spendRatio();
    const budgetTier = budgetTierFor(spendRatio);
    if (budgetTier.warn) {
      request.log.warn({
        event: "budget_warning",
        tier: budgetTier.tier,
        spend_ratio: spendRatio,
        slowdown_ms: budgetTier.slowdown_ms
      }, "demo submission budget warning");
      reply.header("Retry-After", String(budgetTier.slowdown_ms / 1000));
      await (deps.slowdown ?? wait)(budgetTier.slowdown_ms);
    }

    if (spendRatio >= 0.95) {
      return reply.code(503).send(deps.errorEnvelope("submission_intake_disabled"));
    }

    const body = request.body as Record<string, unknown> | undefined;
    if (body === null || typeof body !== "object") {
      return reply.code(400).send(deps.errorEnvelope("submission_schema_invalid"));
    }
    for (const [part, schemaUrn] of Object.entries(SCHEMA_BY_PART)) {
      if (validateProtocolSchema(schemaUrn, body[part]).length > 0) {
        return reply.code(400).send(deps.errorEnvelope("submission_schema_invalid"));
      }
    }

    const manifest = body.bundle_manifest as {
      manifest_id: string;
      evidence_bundle_id: string;
      submission_attempt_id: string;
      artifact_references: { digest: string }[];
    };
    if (manifest.manifest_id !== credential.expected_manifest_id) {
      return reply.code(409).send(deps.errorEnvelope("submission_manifest_not_expected"));
    }
    if (
      credential.expected_evidence_bundle_id !== undefined &&
      manifest.evidence_bundle_id !== credential.expected_evidence_bundle_id
    ) {
      return reply.code(409).send(deps.errorEnvelope("submission_manifest_not_expected"));
    }

    const opened = await deps.attempts.open({
      submission_attempt_id: manifest.submission_attempt_id,
      review_id: credential.review_id,
      tenant_id: credential.tenant_id,
      token_key_id: credential.token_key_id,
      manifest_id: manifest.manifest_id,
      evidence_bundle_id: manifest.evidence_bundle_id,
      bundle_manifest_body: canonical(body.bundle_manifest),
      signature_envelope_body: canonical(body.signature_envelope),
      customer_approval_body: canonical(body.customer_approval),
      approved_outbound_manifest_body: canonical(body.approved_outbound_manifest)
    });
    if (opened.outcome === "conflict") {
      return reply.code(409).send(deps.errorEnvelope("submission_attempt_body_conflict"));
    }

    const missing: string[] = [];
    for (const reference of manifest.artifact_references) {
      if ((await deps.classifications.find(storedObjectRefFor(reference.digest))) === undefined) {
        missing.push(reference.digest);
      }
    }

    return reply.code(opened.outcome === "opened" ? 201 : 200).send({
      submission_attempt_id: opened.record.submission_attempt_id,
      review_id: opened.record.review_id,
      missing_digests: missing
    });
  });

  server.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, payload, done) => {
    done(null, payload);
  });

  server.put<{ Params: { attemptId: string; digest: string } }>(
    "/v0/submissions/:attemptId/artifacts/:digest",
    { bodyLimit: ARTIFACT_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const credential = await authenticate(parseSubmissionCredentialHeader(request.headers.authorization), deps);
      if (credential === undefined) {
        return reply.code(401).send(deps.errorEnvelope("submission_credential_invalid"));
      }

      const attempt = await deps.attempts.find(request.params.attemptId);
      // A caller authenticated for a different review must not learn that
      // this attempt exists, so an out-of-scope attempt is reported as not
      // found rather than forbidden.
      if (attempt === undefined || attempt.token_key_id !== credential.token_key_id) {
        return reply.code(404).send(deps.errorEnvelope("submission_attempt_not_found"));
      }
      if ((await deps.attempts.findOutcome(attempt.submission_attempt_id)) !== undefined) {
        return reply.code(409).send(deps.errorEnvelope("submission_already_finalized"));
      }

      const manifest = JSON.parse(attempt.bundle_manifest_body) as {
        artifact_references: { digest: string; source_derived_class: StoredObjectClassification["source_derived_class"] }[];
      };
      const reference = manifest.artifact_references.find((entry) => entry.digest === request.params.digest);
      if (reference === undefined) {
        return reply.code(409).send(deps.errorEnvelope("submission_artifact_not_in_manifest"));
      }

      const bytes = request.body as Buffer;
      if (!Buffer.isBuffer(bytes)) {
        return reply.code(400).send(deps.errorEnvelope("submission_artifact_body_invalid"));
      }
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actual !== reference.digest) {
        return reply.code(422).send(deps.errorEnvelope("submission_artifact_digest_mismatch"));
      }

      // The environment profile comes from the boot-bound gate, never from
      // the request. classifyStoredObject then refuses
      // customer_opt_in_retained_source outside partner_pilot_real_snippet_ready
      // with no extra check here.
      const classified = classifyStoredObject({
        protocol_version: "codeattest.v0",
        stored_object_ref: storedObjectRefFor(reference.digest),
        object_kind: "evidence_artifact",
        source_derived_class: reference.source_derived_class,
        environment_profile: deps.boundGate.environment_profile
      });
      if (classified.outcome !== "classified") {
        return reply.code(422).send(deps.errorEnvelope("submission_artifact_classification_refused"));
      }

      // Bytes before records (spec section 5.7): a crash here leaves an
      // orphan that no AccessGrant can reach, never a row pointing at bytes
      // that are not there.
      const put = await deps.artifacts.put({
        digest: reference.digest,
        bytes,
        classification: classified.classification,
        reviewId: attempt.review_id
      });
      await deps.classifications.record(classified.classification);

      const missing: string[] = [];
      for (const entry of manifest.artifact_references) {
        if ((await deps.classifications.find(storedObjectRefFor(entry.digest))) === undefined) {
          missing.push(entry.digest);
        }
      }
      return reply.code(200).send({ outcome: put.outcome, missing_digests: missing });
    }
  );

  server.post<{ Params: { attemptId: string } }>("/v0/submissions/:attemptId/finalize", async (request, reply) => {
    const presented = parseSubmissionCredentialHeader(request.headers.authorization);
    const credential = await authenticate(presented, deps);
    if (credential === undefined || presented === undefined) {
      return reply.code(401).send(deps.errorEnvelope("submission_credential_invalid"));
    }

    const attempt = await deps.attempts.find(request.params.attemptId);
    if (attempt === undefined || attempt.token_key_id !== credential.token_key_id) {
      return reply.code(404).send(deps.errorEnvelope("submission_attempt_not_found"));
    }

    // Idempotent by construction: the stored outcome is authoritative, and a
    // replay must never mint a second receipt.
    const stored = await deps.attempts.findOutcome(attempt.submission_attempt_id);
    if (stored !== undefined) {
      return reply.code(200).send({ submission_outcome: JSON.parse(stored) });
    }

    const manifest = JSON.parse(attempt.bundle_manifest_body) as {
      bundle_instance_id: string;
      artifact_references: { artifact_ref: string; digest: string; source_derived_class: StoredObjectClassification["source_derived_class"] }[];
    };

    // Read the bytes back through the store rather than trusting an
    // in-memory copy: a resumed submission's earlier artifacts were written
    // by a different process, and every read is access-logged.
    const artifactBytesByRef: Record<string, Uint8Array> = {};
    for (const reference of manifest.artifact_references) {
      const access = await deps.mintSubmissionAccess(attempt, reference);
      if (access === undefined) {
        return reply.code(409).send(deps.errorEnvelope("submission_artifacts_incomplete"));
      }
      const read = await deps.artifacts.get({ access, digest: reference.digest });
      if (read.outcome !== "read") {
        return reply.code(409).send(deps.errorEnvelope("submission_artifacts_incomplete"));
      }
      artifactBytesByRef[reference.artifact_ref] = read.bytes;
    }

    const spendRatio = await deps.budget.spendRatio();
    const intakeRequest = assembleIntakeRequest({
      attempt,
      credential,
      presentedSecret: presented.secret,
      artifactBytesByRef,
      gate: deps.boundGate,
      spendRatio,
      keyService: deps.keyService,
      verifiedAt: deps.now()
    });

    const verification = await verifyIntakeSubmission(intakeRequest);

    let outcomeResult: Parameters<typeof buildSubmissionOutcome>[0]["result"];
    let vendorReceipt: Parameters<typeof buildSubmissionOutcome>[0]["vendor_receipt"];
    let vendorReceiptSignatureOutcome: Parameters<typeof buildSubmissionOutcome>[0]["vendor_receipt_signature_outcome"];

    if (verification.state !== "verified_receipt_eligible") {
      outcomeResult = verification;
    } else {
      const artifactCountSummary = artifactCountSummaryFromManifest(intakeRequest.approved_outbound_manifest);
      const prepared = await prepareVendorReceipt({
        intake_verification_request: intakeRequest,
        receipt_timestamp: deps.now(),
        signing: {
          key_id: deps.keyService.key_id,
          key_version: deps.keyService.key_version,
          signing_mode: "managed_key",
          canonicalization: "rfc8785",
          public_key_reference: `key-directory-entry:${deps.keyService.key_id}:${deps.keyService.key_version}`,
          signing_limitations: [...MANAGED_KEY_LIMITATIONS]
        },
        approved_artifact_count_summary: artifactCountSummary,
        received_artifact_count_summary: artifactCountSummary
      });
      if (prepared.state !== "receipt_signing_required") {
        outcomeResult = prepared;
      } else {
        const receiptSignature = deps.keyService.sign({ signing_input: prepared.signing_input, signing_time: prepared.unsigned_receipt.receipt_timestamp });
        const receiptSignatureOutcome = deps.keyService.verifier.verify({
          envelope: receiptSignature,
          signing_input: prepared.signing_input,
          verified_at: deps.now()
        });
        const completed = await completeVendorReceipt(prepared, receiptSignature, receiptSignatureOutcome);
        if (completed.state === "received_with_receipt") {
          outcomeResult = verification;
          vendorReceipt = completed.vendor_receipt;
          vendorReceiptSignatureOutcome = receiptSignatureOutcome;
        } else {
          outcomeResult = completed;
        }
      }
    }

    const built = await buildSubmissionOutcome({
      result: outcomeResult,
      review_id: attempt.review_id,
      submission_outcome_id: submissionOutcomeIdFor(attempt.submission_attempt_id),
      occurred_at: deps.now(),
      bundle_instance_id: manifest.bundle_instance_id,
      submission_attempt_id: attempt.submission_attempt_id,
      ...(vendorReceipt === undefined ? {} : { vendor_receipt: vendorReceipt }),
      ...(vendorReceiptSignatureOutcome === undefined ? {} : { vendor_receipt_signature_outcome: vendorReceiptSignatureOutcome })
    });
    if ("rejected" in built) {
      return reply.code(500).send(deps.errorEnvelope("submission_outcome_not_buildable"));
    }

    const eventType =
      built.outcome.outcome_state === "received_with_receipt" ? "receipt_issued" as const
      : built.outcome.outcome_state === "rejected_no_receipt" ? "submission_rejected" as const
      : "submission_quarantined" as const;
    const appended = await deps.appendSubmissionReviewEvent({
      reviewId: attempt.review_id,
      eventType,
      eventTimestamp: deps.now(),
      outcome: built.outcome
    });
    if (appended.outcome === "rejected") {
      return reply.code(500).send(deps.errorEnvelope("submission_outcome_not_buildable"));
    }

    const outcomeBody = JSON.stringify(built.outcome);
    await deps.attempts.recordOutcome(attempt.submission_attempt_id, outcomeBody);

    if (built.outcome.outcome_state === "received_with_receipt") {
      await deps.jobs.enqueue({
        job_id: `job:normalize:${attempt.submission_attempt_id}`,
        job_type: "normalize_scanner_findings",
        payload: JSON.stringify({ review_id: attempt.review_id, submission_attempt_id: attempt.submission_attempt_id })
      });
    }

    return reply.code(200).send({ submission_outcome: built.outcome });
  });
}
