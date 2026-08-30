import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { coverageMarkerResolved, listFiles, loadSchemas, resolveUnderRoot, validateAgainstSchema, validateSchemaDocument } from "../../../scripts/lib/protocol-utils.mjs";

// C7-15/C7-16: resolveUnderRoot() rejects traversing/absolute/portable-invalid
// paths before they are joined onto a trusted fixture/schema root.
const root = await mkdtemp(path.join(os.tmpdir(), "onevps-c7-gates-"));
const fixtureRoot = path.join(root, "fixtures");
await mkdir(fixtureRoot, { recursive: true });

assert.throws(() => resolveUnderRoot(fixtureRoot, "../outside.json", "fixture path"), /fixture path must be portable/u);
assert.throws(() => resolveUnderRoot(fixtureRoot, "/etc/passwd", "fixture path"), /fixture path must be portable/u);
assert.throws(() => resolveUnderRoot(fixtureRoot, "a/../../outside.json", "fixture path"), /fixture path must be portable/u);
assert.equal(resolveUnderRoot(fixtureRoot, "v0/valid/thing.json", "fixture path"), path.join(fixtureRoot, "v0/valid/thing.json"));

// C7-01: two schema files declaring the same $id must fail schema loading
// loudly instead of the second file silently overwriting the first in
// schemaMap (which would make every $ref/fixture lookup resolve against
// only one of the two, undetected).
const schemaRoot = path.join(root, "schemas");
await mkdir(schemaRoot, { recursive: true });
await writeFile(path.join(schemaRoot, "a.schema.json"), JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:codeattest:protocol:v0:dup", type: "object", additionalProperties: false }));
await writeFile(path.join(schemaRoot, "b.schema.json"), JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:codeattest:protocol:v0:dup", type: "string" }));
await assert.rejects(() => loadSchemas(schemaRoot), /duplicate schema \$id/u);

// C7-36: listFiles() must skip symlinks rather than following them, so a
// symlink cycle can't crash the walk and a symlinked directory outside the
// intended root can't smuggle unrelated files into a schema/fixture walk.
const walkRoot = path.join(root, "walk");
await mkdir(path.join(walkRoot, "dir"), { recursive: true });
await writeFile(path.join(walkRoot, "dir", "a.json"), "{}\n");
await symlink(walkRoot, path.join(walkRoot, "dir", "cycle"));
const files = await listFiles(walkRoot);
assert.deepEqual(files.map((file) => path.relative(walkRoot, file)), [path.join("dir", "a.json")]);

// C7-13/C7-14: the dependency-direction and workspace-boundary scanners must
// catch dynamic import() and require(), not just static import/export, and
// the workspace-boundary scanner must cover every source file under src/,
// not only src/index.ts.
const { collectModuleSpecifiers } = await import("../../../scripts/lib/dependency-scan.mjs").then(
  (module) => ({ collectModuleSpecifiers: module.extractJsSpecifiers })
);
assert.deepEqual(collectModuleSpecifiers('import x from "@onevps/ui";'), ["@onevps/ui"]);
assert.deepEqual(collectModuleSpecifiers('export * from "../../apps/control-plane/src/index.js";'), ["../../apps/control-plane/src/index.js"]);
assert.deepEqual(collectModuleSpecifiers('await import("@onevps/static-bundle");'), ["@onevps/static-bundle"]);
assert.deepEqual(collectModuleSpecifiers('const ui = require("@onevps/ui");'), ["@onevps/ui"]);

// C7-17: an invariant coverage marker naming a bare identifier that no
// source file contains (a typo, a renamed/removed function) must not
// resolve, so a fabricated marker can't count as coverage.
const fakeCorpus = { sources: ["function realCheck() {}"], fileBasenames: new Set(["real.test.mjs"]) };
assert.equal(coverageMarkerResolved("realCheck", fakeCorpus), true);
assert.equal(coverageMarkerResolved("validateVerificationRecordSemantics_typo", fakeCorpus), false);
assert.equal(coverageMarkerResolved("real.test.mjs some description of cases", fakeCorpus), true);
assert.equal(coverageMarkerResolved("missing.test.mjs some description of cases", fakeCorpus), false);

// C7-38: important protocol-utils branches were covered only indirectly by
// happy-path aggregate gates, not by targeted negatives -- assert the schema-
// internal error codes directly against small in-memory schemas.
{
  const openSchemaErrors = validateSchemaDocument({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:codeattest:protocol:v0:test", type: "object", properties: {} }, "test.schema.json");
  assert.ok(openSchemaErrors.some((error) => error.code === "schema_open_object"), "an object schema with properties but no additionalProperties:false must fail schema_open_object");

  const camelCaseErrors = validateSchemaDocument({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:codeattest:protocol:v0:test2", type: "object", additionalProperties: false, properties: { camelCase: { type: "string" } } }, "test2.schema.json");
  assert.ok(camelCaseErrors.some((error) => error.code === "schema_field_case"), "a camelCase property name must fail schema_field_case");

  const unresolvedRefErrors = validateAgainstSchema({}, { $ref: "urn:codeattest:protocol:v0:does-not-exist" }, new Map());
  assert.ok(unresolvedRefErrors.some((error) => error.code === "unresolved_ref"), "a $ref that does not resolve in the schema map must fail unresolved_ref");
}

console.log("protocol-ts / scripts C7 gate infrastructure tests passed.");
