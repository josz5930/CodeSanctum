import assert from "node:assert/strict";
import { compileWorkspace } from "./helpers/compile.mjs";

const { actorTypeForRole, selectGrant, EVIDENCE_ACCESS_ROLES } = await compileWorkspace("actor.js");

// The role set is the control-plane's, copied deliberately and asserted here so
// the two cannot drift: apps/control-plane/src/index.ts:746.
assert.deepEqual([...EVIDENCE_ACCESS_ROLES].sort(), [
  "codeattest_ops", "codeattest_reviewer", "customer_admin", "customer_viewer", "evidence_consumer_static"
]);

assert.equal(actorTypeForRole("customer_admin"), "customer_user");
assert.equal(actorTypeForRole("customer_viewer"), "customer_user");
assert.equal(actorTypeForRole("codeattest_reviewer"), "reviewer");
assert.equal(actorTypeForRole("codeattest_ops"), "vendor_service");
assert.equal(actorTypeForRole("evidence_consumer_static"), "vendor_service");
assert.throws(() => actorTypeForRole("root"), /unknown role/, "an unrecognised role is not a role");

const actor = {
  account_id: "account:synthetic-reviewer",
  tenant_id: "tenant-synthetic-demo",
  actor: { actor_type: "reviewer", actor_id: "account:synthetic-reviewer" },
  grants: [
    { role: "customer_viewer", review_scope: "review:synthetic-demo-0001" },
    { role: "codeattest_reviewer", review_scope: null }
  ]
};

// A tenant-wide grant covers any review in the tenant.
assert.equal(selectGrant(actor, "review:synthetic-demo-0002").role, "codeattest_reviewer");

// Where both apply, the review-scoped grant wins: narrower beats broader, so a
// tenant-wide grant can never silently widen a review-specific one.
assert.equal(selectGrant(actor, "review:synthetic-demo-0001").role, "customer_viewer");

// No grant at all is undefined, never a default.
assert.equal(selectGrant({ ...actor, grants: [] }, "review:synthetic-demo-0001"), undefined);

console.log("Actor mapping test passed.");
