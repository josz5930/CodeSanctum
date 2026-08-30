import type { EnvironmentGateStore } from "../../../packages/evidence-store/src/index.js";
import { validateProtocolSchema, type EnvironmentEvidenceGate } from "../../../packages/protocol-ts/src/index.js";

export type GateBindingResult = { ok: true; gate: EnvironmentEvidenceGate } | { ok: false; reason: string };

const ALLOWED_PROFILES_FOR_IDENTITY: Record<"demo" | "pilot", ReadonlySet<string>> = {
  demo: new Set(["synthetic_demo"]),
  pilot: new Set(["partner_pilot_candidate", "partner_pilot_real_snippet_ready"])
};

/**
 * Loads the highest-version environment_evidence_gate row and refuses to
 * boot unless its environment_profile matches this deployment's identity.
 * No runtime path can widen the gate (design doc section 5.3); this check
 * only ever reads what a prior, separate seeding step already wrote.
 */
export async function bindEnvironmentGate(
  store: EnvironmentGateStore,
  deploymentIdentity: "demo" | "pilot"
): Promise<GateBindingResult> {
  const current = await store.loadCurrent();
  if (current === undefined) {
    return { ok: false, reason: "no environment_evidence_gate record exists for this deployment" };
  }

  const errors = validateProtocolSchema("urn:codeattest:protocol:v0:environment-evidence-gate", current.gate);
  if (errors.length > 0) {
    return { ok: false, reason: `gate record fails schema validation: ${errors.map((e) => `${e.location}: ${e.code}`).join("; ")}` };
  }

  const allowedProfiles = ALLOWED_PROFILES_FOR_IDENTITY[deploymentIdentity];
  if (!allowedProfiles.has(current.gate.environment_profile)) {
    return {
      ok: false,
      reason: `deployment_identity "${deploymentIdentity}" does not accept gate environment_profile "${current.gate.environment_profile}"`
    };
  }

  return { ok: true, gate: current.gate };
}
