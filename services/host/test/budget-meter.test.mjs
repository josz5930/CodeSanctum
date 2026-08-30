import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { AUTH_HEADER, buildTestServer } from "./helpers/submission-fixtures.mjs";

const { createEventDerivedBudgetMeter } = await importCompiled("src/submission/event-derived-budget-meter.js");
const { budgetTierFor } = await importCompiled("src/submission/budget-tiers.js");

function event(event_type, event_timestamp) {
  return { event_type, event_timestamp };
}

const events = [
  event("receipt_issued", "2026-08-01T00:00:00Z"),
  event("submission_rejected", "2026-08-15T12:00:00Z"),
  event("submission_quarantined", "2026-08-31T23:59:59Z"),
  event("classification_recorded", "2026-08-20T00:00:00Z"),
  event("receipt_issued", "2026-07-31T23:59:59Z"),
  event("receipt_issued", "2026-09-01T00:00:00Z")
];

const requestedRanges = [];
const eventLog = {
  async loadEventsByTimestampRange(startInclusive, endExclusive) {
    requestedRanges.push({ startInclusive, endExclusive });
    return events.filter(({ event_timestamp }) =>
      event_timestamp >= startInclusive && event_timestamp < endExclusive
    );
  }
};

const meter = createEventDerivedBudgetMeter({
  eventLog,
  config: { monthly_unit_ceiling: 20, unit_per_billable_event: 2 },
  now: () => new Date("2026-08-21T04:00:00Z")
});

assert.equal(await meter.spendRatio(), 0.3);
assert.deepEqual(requestedRanges, [{
  startInclusive: "2026-08-01T00:00:00.000Z",
  endExclusive: "2026-09-01T00:00:00.000Z"
}]);

// A ratio above the ceiling is capped at one; callers never receive a value
// outside the BudgetMeter contract's enforcement range.
const capped = createEventDerivedBudgetMeter({
  eventLog: {
    async loadEventsByTimestampRange() {
      return Array.from({ length: 12 }, () => event("receipt_issued", "2026-08-10T00:00:00Z"));
    }
  },
  config: { monthly_unit_ceiling: 10, unit_per_billable_event: 1 },
  now: () => new Date("2026-08-21T04:00:00Z")
});
assert.equal(await capped.spendRatio(), 1);

// Calendar boundaries are UTC and roll cleanly over December.
let decemberRange;
const december = createEventDerivedBudgetMeter({
  eventLog: {
    async loadEventsByTimestampRange(startInclusive, endExclusive) {
      decemberRange = { startInclusive, endExclusive };
      return [];
    }
  },
  config: { monthly_unit_ceiling: 1, unit_per_billable_event: 1 },
  now: () => new Date("2026-12-31T23:59:59Z")
});
assert.equal(await december.spendRatio(), 0);
assert.deepEqual(decemberRange, {
  startInclusive: "2026-12-01T00:00:00.000Z",
  endExclusive: "2027-01-01T00:00:00.000Z"
});

assert.deepEqual(budgetTierFor(0.49), { tier: "normal", warn: false, slowdown_ms: 0 });
assert.deepEqual(budgetTierFor(0.5), { tier: "warning_50", warn: true, slowdown_ms: 1000 });
assert.deepEqual(budgetTierFor(0.75), { tier: "warning_75", warn: true, slowdown_ms: 2000 });
assert.deepEqual(budgetTierFor(0.9), { tier: "warning_90", warn: true, slowdown_ms: 3000 });

// Submission intake emits one structured warning, delays through an
// injectable seam, and returns a tier-scaled Retry-After hint. An invalid
// body is sufficient here because budget enforcement runs after credential
// authentication and before protocol validation.
{
  let spendRatio = 0.49;
  const slowdowns = [];
  const captured = [];
  const { server } = await buildTestServer({
    budget: { async spendRatio() { return spendRatio; } },
    slowdown: async (milliseconds) => { slowdowns.push(milliseconds); },
    logger: { stream: { write: (line) => captured.push(JSON.parse(line)) }, level: "warn" }
  });

  for (const expected of [
    { ratio: 0.49, tier: undefined, slowdown: undefined, retryAfter: undefined },
    { ratio: 0.5, tier: "warning_50", slowdown: 1000, retryAfter: "1" },
    { ratio: 0.75, tier: "warning_75", slowdown: 2000, retryAfter: "2" },
    { ratio: 0.9, tier: "warning_90", slowdown: 3000, retryAfter: "3" }
  ]) {
    spendRatio = expected.ratio;
    const beforeLogs = captured.length;
    const beforeSlowdowns = slowdowns.length;
    const response = await server.inject({
      method: "POST",
      url: "/v0/submissions",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      payload: {}
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers["retry-after"], expected.retryAfter);
    assert.equal(slowdowns.at(-1), expected.slowdown);
    if (expected.tier === undefined) {
      assert.equal(captured.length, beforeLogs);
      assert.equal(slowdowns.length, beforeSlowdowns);
    } else {
      const warning = captured.at(-1);
      assert.equal(warning.event, "budget_warning");
      assert.equal(warning.tier, expected.tier);
      assert.equal(warning.spend_ratio, expected.ratio);
      assert.equal(warning.slowdown_ms, expected.slowdown);
    }
  }

  // F extends the existing seam; it does not move or rename the 95% cutoff.
  spendRatio = 0.95;
  const cutoff = await server.inject({
    method: "POST",
    url: "/v0/submissions",
    headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
    payload: {}
  });
  assert.equal(cutoff.statusCode, 503);
  assert.equal(cutoff.json().reason_code, "submission_intake_disabled");
  assert.equal(cutoff.headers["retry-after"], "3");
  await server.close();
}

console.log("Event-derived budget meter and staged tier test passed.");
