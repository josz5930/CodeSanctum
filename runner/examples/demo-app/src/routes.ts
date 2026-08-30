// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE
//
// A second synthetic source file so the demo scan covers more than one file.
// This one has no findings; it is here only to make the scanned-file summary
// more representative.

import { evaluateExpression, type DemoRequest } from "./app.js";

export interface DemoRoute {
  readonly path: string;
  readonly handle: (request: DemoRequest) => unknown;
}

export const demoRoutes: readonly DemoRoute[] = [
  {
    path: "/evaluate",
    handle: (request) => evaluateExpression(request)
  }
];
