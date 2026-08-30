import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..", "..");
const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
const tsconfigPath = path.join(testDir, "tsconfig.generated-types-contract.json");

try {
  execFileSync(process.execPath, [tscBin, "-p", tsconfigPath], { stdio: "pipe", encoding: "utf8" });
} catch (error) {
  throw new Error(
    `generated-types-contract.ts failed to typecheck -- this means the protocol-types generator no longer renders ` +
      `allOf/if/then conditional requirements as discriminated unions (see C7-02):\n${error.stdout ?? ""}${error.stderr ?? ""}`
  );
}

console.log("protocol-ts generated-types conditional-requirement contract tests passed.");
