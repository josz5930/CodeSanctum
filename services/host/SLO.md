# Host Service-Level Objectives

Status: initial single-VPS pilot objectives

Measurement source: structured `event: "metric"` records emitted by the host

These are operational objectives for the CodeAttest host. They describe the
availability and responsiveness of the service; they are not claims about the
security of submitted code or a substitute for an auditor.

## Objectives

| Signal | Objective | Measurement window |
| --- | --- | --- |
| Readiness availability | At least 99.5% of scheduled `/readyz` probes return `200` | Rolling 30 days |
| Submission intake success rate | At least 99.0% of eligible submission requests complete without a host-side `5xx` response | Rolling 7 days, minimum 20 eligible requests |
| Submission latency | At least 95% of eligible submission requests complete within 5,000 ms | Rolling 24 hours, minimum 20 eligible requests |

An eligible submission request is a request whose route template starts with
`/v0/submissions`. Authentication, schema, conflict, and other caller-caused
`4xx` responses are excluded from the success-rate denominator. Host-side
`5xx` responses, including deliberate budget enforcement, remain visible to
operations and count as unavailable intake. The latency objective includes the
configured 50/75/90% budget slowdowns, so its threshold is deliberately above
the largest three-second delay.

## Metric records

Every served response emits an `http_request` metric record containing the
stable route template, method, status code, and elapsed milliseconds. A
`readiness_availability` record is emitted when the observed `/readyz` state
changes. Request and response headers are never included in metric records;
ordinary request logs continue to use the host's secret-header redaction.

Task 6's loopback check samples `/readyz`, appends these JSON records to a local
metrics file, evaluates the objectives when their minimum sample sizes are met,
and exits non-zero on a breach. A systemd timer runs that check and records an
alert in journald, with an optional operator notification hook.
