import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

const ui = await importCompiled("../../packages/ui/src/index.js");
const { StatusPill } = await importCompiled("components/StatusPill.js");
const { RiskWarning } = await importCompiled("components/RiskWarning.js");

// Visible text carrying HTML metacharacters is entity-escaped at the render boundary.
const pill = { ...ui.StatusPill({ state: "received_with_receipt" }), visibleLabel: "A & B < C", accessibleLabel: "A & B < C: meaning" };
const pillHtml = renderToStaticMarkup(createElement(StatusPill, { view: pill }));
assert.match(pillHtml, /A &amp; B &lt; C/);
assert.ok(!pillHtml.includes("A & B < C"), "raw metacharacters must not survive to the output");

const warning = ui.RiskWarning({
  title: "Rejected & <flagged>",
  message: "No Vendor Receipt <exists>",
  riskType: "rejected_no_receipt",
  audience: "customer",
  affectedIdentity: { label: "Review", value: "review:x & y" }
});
const warningHtml = renderToStaticMarkup(createElement(RiskWarning, { view: warning }));
assert.equal(warning.role, "alert");
assert.match(warningHtml, /role="alert"/);
assert.match(warningHtml, /Rejected &amp; &lt;flagged&gt;/);
assert.ok(!warningHtml.includes("<flagged>"), "raw markup in the title must not survive");

// No adapter uses dangerouslySetInnerHTML.
const componentsDir = fileURLToPath(new URL("../components", import.meta.url));
for (const entry of await readdir(componentsDir)) {
  if (!entry.endsWith(".tsx") && !entry.endsWith(".ts")) {
    continue;
  }
  const source = await readFile(path.join(componentsDir, entry), "utf8");
  assert.ok(!source.includes("dangerouslySetInnerHTML"), `${entry} must not use dangerouslySetInnerHTML`);
}

console.log("@onevps/web adapter escaping test passed.");
