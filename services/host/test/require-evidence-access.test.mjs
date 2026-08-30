import assert from "node:assert/strict";
import { buildTestServer, SEEDED, loginAs } from "./helpers/identity-fixtures.mjs";

const { server, ports } = await buildTestServer();
const cookie = await loginAs(server, SEEDED.customer);

// A route reachable only through requireEvidenceAccess, registered by the test
// harness so this file tests the bridge rather than a business endpoint.
const allowed = await server.inject({
  method: "GET",
  url: `/test/evidence/${SEEDED.artifactRefInScope}`,
  headers: { cookie }
});
assert.equal(allowed.statusCode, 200);

// The access is logged, in the same transaction that returned the bytes.
const lifecycle = await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope);
const accessed = lifecycle.filter((event) => event.event_type === "evidence_accessed");
assert.equal(accessed.length, 1);
assert.equal(accessed[0].actor.actor_type, "customer_user");
assert.equal(accessed[0].actor.actor_id, SEEDED.customer.account_id);
assert.equal(accessed[0].access_scope.tenant_id, SEEDED.customer.tenant_id);
assert.equal(accessed[0].access_scope.review_scope, SEEDED.reviewInScope);
assert.equal(accessed[0].purpose, "customer_review_read");

// Out of scope: a different tenant's artifact is denied and nothing is logged.
const before = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewOutOfScope)).length;
const denied = await server.inject({
  method: "GET",
  url: `/test/evidence/${SEEDED.artifactRefOtherTenant}`,
  headers: { cookie }
});
assert.equal(denied.statusCode, 403);
assert.equal(denied.json().reason_code, "evidence_access_denied");
assert.equal((await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewOutOfScope)).length, before,
  "a denial appends nothing");

// No session at all.
const anonymous = await server.inject({ method: "GET", url: `/test/evidence/${SEEDED.artifactRefInScope}` });
assert.equal(anonymous.statusCode, 401);

// A session pending its second factor is not a session.
const pending = await server.inject({
  method: "GET", url: `/test/evidence/${SEEDED.artifactRefInScope}`,
  headers: { cookie: SEEDED.pendingCookie }
});
assert.equal(pending.statusCode, 401);

// The request body cannot widen scope: a body naming another tenant changes
// nothing, because requireEvidenceAccess never reads one.
const spoofed = await server.inject({
  method: "GET",
  url: `/test/evidence/${SEEDED.artifactRefOtherTenant}?tenant_id=${SEEDED.otherTenantId}&role=codeattest_ops`,
  headers: { cookie }
});
assert.equal(spoofed.statusCode, 403);

// Dual-grant: grants[0] is tenant-wide reviewer (actor_type reviewer), but the
// in-scope artifact matches the narrower customer_viewer grant.
const dualCookie = await loginAs(server, SEEDED.dualRole);
const dualAllowed = await server.inject({
  method: "GET",
  url: `/test/evidence/${SEEDED.artifactRefInScope}`,
  headers: { cookie: dualCookie }
});
assert.equal(dualAllowed.statusCode, 200);
const dualAccessed = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
  .filter((event) => event.event_type === "evidence_accessed" && event.actor.actor_id === SEEDED.dualRole.account_id);
assert.equal(dualAccessed.length, 1);
assert.equal(dualAccessed[0].actor.actor_type, "customer_user",
  "the selected grant's actor_type is logged, not grants[0]");

await server.close();
console.log("Evidence access bridge test passed.");
