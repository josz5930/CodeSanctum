import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function requirePattern(text, pattern, description, failures) {
  if (!pattern.test(text)) {
    failures.push(description);
  }
}

export async function checkDemoBudgetGuardrail(root = repoRoot) {
  const [tiers, submissions, main, readinessTest, rootPackageText] = await Promise.all([
    readFile(path.join(root, "services/host/src/submission/budget-tiers.ts"), "utf8"),
    readFile(path.join(root, "services/host/src/routes/submissions.ts"), "utf8"),
    readFile(path.join(root, "services/host/src/main.ts"), "utf8"),
    readFile(path.join(root, "services/host/test/budget-guardrail.test.mjs"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8")
  ]);
  const failures = [];

  requirePattern(tiers, /ratio >= 0\.9[\s\S]*ratio >= 0\.75[\s\S]*ratio >= 0\.5/, "budget tiers do not enforce 90/75/50% thresholds", failures);
  requirePattern(submissions, /budgetTierFor\(spendRatio\)/, "submission intake does not apply budget tiers", failures);
  requirePattern(submissions, /header\("Retry-After"/, "submission intake does not emit Retry-After", failures);
  requirePattern(submissions, /spendRatio >= 0\.95/, "the existing 95% intake cutoff is missing or changed", failures);
  requirePattern(submissions, /event: "budget_halted"/, "the demo halt does not emit a structured event", failures);
  requirePattern(main, /config\.deployment_identity === "demo"[\s\S]*createEventDerivedBudgetMeter/, "the event-derived meter is not wired for demo", failures);
  requirePattern(main, /registerBudgetHaltGuard\(server,[\s\S]*deploymentIdentity: config\.deployment_identity[\s\S]*budget/, "the demo halt guard is not wired at the host composition root", failures);
  requirePattern(readinessTest, /monthly_unit_ceiling: 20[\s\S]*runBootSequence\(/, "the readiness test does not boot a demo config with a valid ceiling", failures);

  const rootPackage = JSON.parse(rootPackageText);
  const deliveryCheck = rootPackage.scripts?.["delivery:f-check"];
  if (typeof deliveryCheck !== "string" || !deliveryCheck.includes("check-demo-budget-guardrail.mjs")) {
    failures.push("delivery:f-check does not include the demo budget guardrail check");
  }

  return failures;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await checkDemoBudgetGuardrail();
  if (failures.length > 0) {
    console.error("Demo budget guardrail check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("Demo budget guardrail check passed.");
}
