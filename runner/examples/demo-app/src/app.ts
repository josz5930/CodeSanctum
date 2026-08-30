// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE
//
// Synthetic handler for the CodeAttest Local Runner demo. The `eval(` call
// below is intentional: it exists so the demo regex scanner produces a
// Candidate Finding. This is not real, and not customer, source code.

export interface DemoRequest {
  readonly expression: string;
}

// Deliberately unsafe: evaluates caller-supplied input. The demo scanner rule
// `demo.regex.eval` matches the `eval(` token on the next line.
export function evaluateExpression(request: DemoRequest): unknown {
  return eval(request.expression);
}
