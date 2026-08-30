import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

const ui = await importCompiled("../../packages/ui/src/index.js");
const { StatusPill } = await importCompiled("components/StatusPill.js");
const { AppShell } = await importCompiled("components/AppShell.js");

const shell = ui.AppShell({ actorContext: { label: "customer_viewer", id: "account:synthetic-customer" } });
const reviews = [
  ui.StatusPill({ state: "received_with_receipt" }),
  ui.StatusPill({ state: "rejected_no_receipt" })
];

// One pill per review, each with its visible label.
const listHtml = renderToStaticMarkup(
  createElement(
    "ul",
    null,
    reviews.map((pill, index) => createElement("li", { key: index }, createElement(StatusPill, { view: pill })))
  )
);
assert.equal((listHtml.match(/data-slot="status-pill"/g) ?? []).length, reviews.length, "one pill per review");
assert.match(listHtml, /Received with receipt/);
assert.match(listHtml, /Rejected without receipt/);

// The shell wraps the dashboard body and exposes the signed-in actor context.
const shellHtml = renderToStaticMarkup(
  createElement(
    AppShell,
    { view: shell },
    reviews.map((pill, index) => createElement("li", { key: index }, createElement(StatusPill, { view: pill })))
  )
);
assert.match(shellHtml, /customer_viewer/);
assert.match(shellHtml, /account:synthetic-customer/);
assert.match(shellHtml, /Received with receipt/);
assert.match(shellHtml, /Rejected without receipt/);

// The shell's sign-out control is an actionable element carrying the 44px/focus/reduced-motion metadata.
assert.match(shellHtml, /data-min-target-size-px="44"/);
assert.match(shellHtml, /data-focus-ring=/);
assert.match(shellHtml, /data-reduced-motion=/);
assert.match(shellHtml, /action="\/logout"/);
assert.doesNotMatch(shellHtml, /tabindex="[1-9]/i, "no positive tabIndex");

console.log("@onevps/web dashboard render test passed.");
