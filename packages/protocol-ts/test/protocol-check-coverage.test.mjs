import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureIndex = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "fixture-index.json"), "utf8"));
const invariants = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "invariants.json"), "utf8"));
const protocolCheck = await import(pathToFileURL(path.join(repoRoot, "scripts", "protocol-check.mjs")).href);

assert(typeof protocolCheck.protocolCheckRequiredStory41CoverageErrors === "function", "protocol check coverage helper must be exported");
assert(protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex, invariants }).length === 0, "current Story 4.1 fixture and invariant coverage must pass");

const missingFixtureIndex = structuredClone(fixtureIndex);
missingFixtureIndex.negative_fixtures = missingFixtureIndex.negative_fixtures.filter((entry) => entry.path !== "v0/invalid/verification-pass-scope.deadline-plus-one-ns.json");
assert(
  protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex: missingFixtureIndex, invariants }).some((error) => error.includes("required Story 4.1 fixture registration is missing")),
  "missing required Story 4.1 fixture registration must fail"
);

const placeholderInvariants = structuredClone(invariants);
const invariant = placeholderInvariants.invariants.find((entry) => entry.id === "verification-scope-events-append-only-boundary");
invariant.javascript_coverage = ["placeholder"];
assert(
  protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex, invariants: placeholderInvariants }).some((error) => error.includes("must be executable markers")),
  "placeholder Story 4.1 invariant coverage must fail"
);

const missingEpic4FixtureIndex = structuredClone(fixtureIndex);
missingEpic4FixtureIndex.valid_fixtures = missingEpic4FixtureIndex.valid_fixtures.filter((entry) => entry.path !== "v0/valid/verification-addendum.finalized.json");
assert(
  protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex: missingEpic4FixtureIndex, invariants }).some((error) => error.includes("verification-addendum.finalized")),
  "missing required Story 4.4 fixture registration must fail"
);

const placeholderEpic4Invariants = structuredClone(invariants);
placeholderEpic4Invariants.invariants.find((entry) => entry.id === "verification-decision-reviewer-criteria-chain").javascript_coverage = ["tbd"];
assert(
  protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex, invariants: placeholderEpic4Invariants }).some((error) => error.includes("must be executable markers")),
  "placeholder Story 4.3 invariant coverage must fail"
);

const missingEpic5FixtureIndex = structuredClone(fixtureIndex);
missingEpic5FixtureIndex.valid_fixtures = missingEpic5FixtureIndex.valid_fixtures.filter((entry) => entry.path !== "v0/valid/security-review-attestation.json");
assert(
  protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex: missingEpic5FixtureIndex, invariants }).some((error) => error.includes("security-review-attestation")),
  "missing required Epic 5 Attestation fixture registration must fail"
);

const placeholderEpic5Invariants = structuredClone(invariants);
placeholderEpic5Invariants.invariants.find((entry) => entry.id === "pilot-learning-internal-content-free-boundary").javascript_coverage = ["placeholder"];
assert(
  protocolCheck.protocolCheckRequiredStory41CoverageErrors({ fixtureIndex, invariants: placeholderEpic5Invariants }).some((error) => error.includes("must be executable markers")),
  "placeholder Epic 5 invariant coverage must fail"
);

console.log("protocol-check Epic 4 and Epic 5 coverage tests passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
