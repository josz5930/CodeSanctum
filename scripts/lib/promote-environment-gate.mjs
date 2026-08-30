import { canonicalize, sha256IdFromCanonical } from "./protocol-utils.mjs";

export const ENVIRONMENT_READINESS_CONTROLS = [
  "access_control_ready",
  "access_logging_ready",
  "encryption_at_rest_ready",
  "retention_defaults_ready",
  "deletion_controls_ready",
  "demo_budget_gate_ready",
  "signing_release_trust_ready"
];

const FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

function actorIdentity(actor) {
  return actor && typeof actor.actor_type === "string" && typeof actor.actor_id === "string"
    ? `${actor.actor_type}:${actor.actor_id}`
    : undefined;
}

function reason(code, message) {
  return { code, message };
}

function gateApprovalInput(gate) {
  const input = { ...gate };
  delete input.readiness_decision_ref;
  return input;
}

export function evaluateEnvironmentGatePromotion(input) {
  const reasons = [];
  const decision = input.decision;
  const proposedGate = input.proposedGate;
  const evidenceRecords = Array.isArray(input.evidenceRecords) ? input.evidenceRecords : [];
  const evidenceById = new Map(evidenceRecords.map((record) => [record.readiness_evidence_id, record]));
  const now = Date.parse(input.now);
  const decidedAt = Date.parse(decision?.decided_at);
  const currentVersion = input.current?.version;
  const bindings = Array.isArray(decision?.evidence_bindings) ? decision.evidence_bindings : [];
  const controls = bindings.map((binding) => binding?.control);
  const controlSet = new Set(controls);

  if (decision?.decision !== "approved") {
    reasons.push(reason("decision_not_approved", "promotion requires an approved environment readiness decision"));
  }
  if (decision?.proposed_gate_version !== decision?.previous_gate_version + 1 || currentVersion !== decision?.previous_gate_version) {
    reasons.push(reason("nonconsecutive_version", "proposed gate version must immediately follow the persisted previous version"));
  }
  if (
    bindings.length !== ENVIRONMENT_READINESS_CONTROLS.length ||
    controlSet.size !== ENVIRONMENT_READINESS_CONTROLS.length ||
    ENVIRONMENT_READINESS_CONTROLS.some((control) => !controlSet.has(control))
  ) {
    reasons.push(reason("duplicate_or_missing_control", "decision must bind exactly one evidence record for each of the seven controls"));
  }

  const producers = new Set();
  for (const binding of bindings) {
    const evidence = evidenceById.get(binding?.readiness_evidence_ref);
    if (evidence === undefined) {
      reasons.push(reason("duplicate_or_missing_control", `decision cannot resolve evidence for ${binding?.control ?? "unknown control"}`));
      continue;
    }
    const producer = actorIdentity(evidence.evidence_producer);
    if (producer !== undefined) producers.add(producer);
    if (evidence.control !== binding.control) {
      reasons.push(reason("duplicate_or_missing_control", `evidence bound as ${binding.control} declares ${evidence.control}`));
    }
    if (
      evidence.deployment_identity !== decision.deployment_identity ||
      evidence.release_digest !== decision.release_digest ||
      evidence.deployment_digest !== decision.deployment_digest
    ) {
      reasons.push(reason("unbound_release", `evidence for ${binding.control} must bind the decision's exact pilot release and deployment digests`));
    }
    if (decision.decision === "approved" && evidence.result !== "passed") {
      reasons.push(reason("failed_control", `approved promotion requires passing evidence for ${binding.control}`));
    }
    const observedAt = Date.parse(evidence.observed_at);
    const reviewedAt = Date.parse(evidence.reviewed_at);
    const staleAgainstDecision = !Number.isFinite(decidedAt) ||
      !Number.isFinite(observedAt) ||
      !Number.isFinite(reviewedAt) ||
      reviewedAt > decidedAt ||
      observedAt > decidedAt ||
      decidedAt - observedAt > FRESHNESS_MS ||
      decidedAt - reviewedAt > FRESHNESS_MS;
    const staleAgainstNow = !Number.isFinite(now) ||
      !Number.isFinite(observedAt) ||
      !Number.isFinite(reviewedAt) ||
      now - observedAt > FRESHNESS_MS ||
      now - reviewedAt > FRESHNESS_MS ||
      (Number.isFinite(decidedAt) && now - decidedAt > FRESHNESS_MS);
    if (decision.decision === "approved" && (staleAgainstDecision || staleAgainstNow)) {
      reasons.push(reason("stale_evidence", `evidence for ${binding.control} is older than seven days at promotion time`));
    }
  }

  const approverIds = Array.isArray(decision?.approvers)
    ? decision.approvers.map((approver) => actorIdentity(approver?.actor))
    : [];
  if (approverIds.some((identity) => identity !== undefined && producers.has(identity))) {
    reasons.push(reason("self_approval", "final approvers must not approve evidence they produced"));
  }

  if (input.signatureResult?.result !== "verified") {
    reasons.push(reason("invalid_signature", "approved decision signature must verify before promotion"));
  }

  try {
    const approvalDigest = sha256IdFromCanonical(gateApprovalInput(proposedGate));
    if (approvalDigest !== decision?.proposed_gate_approval_input_digest) {
      reasons.push(reason("gate_body_mismatch", "decision must bind the canonical proposed gate body excluding readiness_decision_ref"));
    }
  } catch {
    reasons.push(reason("gate_body_mismatch", "proposed gate body is not canonicalizable"));
  }

  if (
    proposedGate?.environment_profile === "partner_pilot_real_snippet_ready" &&
    proposedGate?.readiness_decision_ref !== decision?.readiness_decision_id
  ) {
    reasons.push(reason("gate_body_mismatch", "final gate readiness_decision_ref must equal the approved decision identity"));
  }

  const uniqueReasons = [];
  const seen = new Set();
  for (const item of reasons) {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueReasons.push(item);
  }

  return {
    ok: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    identities: {
      readiness_decision_id: decision?.readiness_decision_id,
      previous_gate_version: decision?.previous_gate_version,
      proposed_gate_version: decision?.proposed_gate_version,
      proposed_gate_approval_input_digest: decision?.proposed_gate_approval_input_digest,
      evidence_ids: bindings.map((binding) => binding?.readiness_evidence_ref).filter(Boolean)
    }
  };
}

export function formatPromotionReport(evaluation) {
  const lines = [
    evaluation.ok ? "promotion: pass" : "promotion: fail",
    `readiness_decision_id: ${evaluation.identities.readiness_decision_id ?? "missing"}`,
    `previous_gate_version: ${evaluation.identities.previous_gate_version ?? "missing"}`,
    `proposed_gate_version: ${evaluation.identities.proposed_gate_version ?? "missing"}`,
    `proposed_gate_approval_input_digest: ${evaluation.identities.proposed_gate_approval_input_digest ?? "missing"}`,
    `evidence_ids: ${(evaluation.identities.evidence_ids ?? []).join(",")}`
  ];
  for (const item of evaluation.reasons) {
    lines.push(`reason: ${item.code}: ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}

async function withTransaction(sql, fn) {
  if (typeof sql.withConnection === "function") {
    return sql.withConnection(async (client) => runTransaction(client, fn));
  }
  if (typeof sql.connect === "function") {
    const client = await sql.connect();
    try {
      return await runTransaction(client, fn);
    } finally {
      client.release();
    }
  }
  return runTransaction(sql, fn);
}

async function runTransaction(client, fn) {
  await client.query("BEGIN");
  try {
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function insertCanonical(client, table, idColumn, id, body) {
  const inserted = await client.query(
    `INSERT INTO ${table} (${idColumn}, body) VALUES ($1, $2)
     ON CONFLICT (${idColumn}) DO NOTHING
     RETURNING ${idColumn}`,
    [id, body]
  );
  if (inserted.rows.length > 0) {
    return "recorded";
  }
  const existing = await client.query(`SELECT body FROM ${table} WHERE ${idColumn} = $1`, [id]);
  const existingBody = existing.rows[0]?.body;
  if (existingBody === body) {
    return "already_present";
  }
  throw new Error(`body_conflict:${table}:${id}`);
}

export async function persistEnvironmentGatePromotion(input) {
  if (input.dryRun) {
    return { outcome: "dry_run" };
  }
  if (!input.evaluation?.ok) {
    return { outcome: "refused", reasons: input.evaluation?.reasons ?? [] };
  }

  return withTransaction(input.sql, async (client) => {
    const current = await client.query("SELECT version FROM environment_evidence_gate ORDER BY version DESC LIMIT 1");
    const currentVersion = current.rows[0] === undefined ? undefined : Number(current.rows[0].version);
    if (currentVersion !== input.decision.previous_gate_version) {
      throw new Error("nonconsecutive_version");
    }

    for (const evidence of input.evidenceRecords) {
      await insertCanonical(
        client,
        "environment_readiness_evidence",
        "readiness_evidence_id",
        evidence.readiness_evidence_id,
        canonicalize(evidence)
      );
    }
    await insertCanonical(
      client,
      "environment_readiness_decision",
      "readiness_decision_id",
      input.decision.readiness_decision_id,
      canonicalize(input.decision)
    );
    const gateInsert = await client.query(
      `INSERT INTO environment_evidence_gate (version, body) VALUES ($1, $2)
       ON CONFLICT (version) DO NOTHING
       RETURNING version`,
      [input.decision.proposed_gate_version, canonicalize(input.proposedGate)]
    );
    if (gateInsert.rows.length === 0) {
      throw new Error("nonconsecutive_version");
    }
    return { outcome: "promoted" };
  });
}
