import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertWorkspaceScaffold } from "../../../scripts/scaffold-test-helpers.mjs";
import { importCompiled } from "./helpers/compile.mjs";

await assertWorkspaceScaffold(new URL("..", import.meta.url));

const { RootLayout } = await importCompiled("src/root-layout.js");
const { RootPage } = await importCompiled("src/root-page.js");
const { APP_TITLE } = await importCompiled("src/app-title.js");

assert.equal(typeof RootLayout, "function");
assert.equal(typeof RootPage, "function");
assert.equal(APP_TITLE, "CodeAttest");

const html = renderToStaticMarkup(createElement(RootLayout, null, createElement(RootPage)));
assert.match(html, /CodeAttest/);

console.log("@onevps/web renderToStaticMarkup title assertion passed.");
