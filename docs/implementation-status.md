# CodeAttest Implementation Status

Status: Detailed implemented-vs-deferred inventory
Audience: technical evaluators, contributors, diligence teams
Last updated: 2026-08-30

This document is the long-form companion to the summary table in the root
[README](../README.md#whats-implemented). It records, in the project's own
terminology, exactly what is implemented and tested today and what is
deliberately deferred. For the work still required before the pilot can accept
real customer evidence, see the
[Production-Readiness Guide](./codeattest-production-readiness.md).

Nothing here asserts production readiness, live operation, or that any live
control passed. Where a check exercises repository machinery, that is stated
explicitly — a passing repository gate is not a gate raise.

## Implemented and tested today

- Protocol schemas, RFC 8785 / JCS canonicalization, identities, fixtures,
  invariants, and the protocol-owned claim-safety policy.
- A working Rust Local Runner CLI (scope → scan → disclosure → manifest → approve
  → sign, plus local status, trust, and failure/rerun records — all local-only).
- TypeScript intake verification, approved-vs-received comparison, Vendor Receipt
  issuance, and submission-outcome logic (as library functions).
- Worker-side Candidate Finding normalization.
- Control-plane logic for review history, evidence lifecycle, classification,
  remediation, validation, false-positive/accepted-risk, verification,
  Attestation, supporting-evidence mapping, static-bundle records, and
  internal-only pilot learning (as library functions).
- Serializable UI view contracts for receipt, review, verification, Attestation,
  and export surfaces.
- Signed Static Bundle generation helpers and a self-contained offline portal
  projection.
- A durable persistence tier for the pure library functions: seven ports
  (review-event log, evidence-lifecycle log, artifact store, classification,
  retention, environment gate, job queue) with memory and Postgres/filesystem
  adapters proven identical by one shared contract suite. Append-only history is
  enforced by Postgres role grants rather than application convention; artifact
  bytes are content-addressed on disk and unreadable without an allowed access
  decision whose lifecycle event is persisted in the same operation that returns
  the bytes. Delivered as library functions in `packages/evidence-store/`.
- An HTTP host (`services/host/`) with a fail-closed boot ladder,
  health/readiness routes, three-phase submission endpoints, opaque sessions with
  optional TOTP, scoped/logged evidence access, authenticated read-only web
  projections, structured SLO metric records, and a loopback SLO checker.
- A Next.js App Router application (`apps/web/`) rendering login/session,
  dashboard, review, finding, verification, Attestation, and static-bundle view
  contracts; `web:e-check` includes its production build.
- F's in-repo always-on delivery surface: the demo budget guard, SLO definitions
  and metric records, a loopback alert timer, isolated demo/pilot host and web
  systemd templates, two-hostname Caddy TLS routing, deploy/rollback scripts, and
  an idempotent provisioning runbook; `delivery:f-check` carries the mechanical
  evidence.

## Readiness-acceptance (G) machinery

The G tasks build the acceptance-proof machinery used to gate real customer
evidence. They prove repository machinery, not live control outcomes.

- **G Task 1 — readiness-acceptance protocol:** content-addressed per-control
  evidence records, approved/declined decisions, managed-key decision signing,
  exact final-gate linkage, and fail-closed semantic fixtures. This is acceptance
  proof machinery; it does not assert that any live control passed.
- **G Task 2 — append-only readiness persistence and transactional promotion:**
  identity-keyed evidence/decision stores; migrator-authority promotion that
  refuses stale, duplicate/missing, self-approved, invalid-signature,
  nonconsecutive, unbound-release, and gate-body-mismatch cases; plus a dry-run
  report that prints identities rather than attachments or secrets.
- **G Task 3 — redacted evidence collector:** command/check identity, tool
  version, UTC time, release/deployment binding, SHA-256 of a secret-redacted
  attachment, refusal of required-tool skips and off-release results, plus
  deterministic synthetic canaries and a reviewer rerun manifest.
- **G Task 4 — encryption blocker machinery:** AES-256-GCM envelopes for
  source-derived object bytes, a boot-time `findmnt` crypt/mapper probe, and an
  inventory of Postgres/temp/journal/backup paths. Live infrastructure-security
  approval is not claimed.
- **G Task 5 — retention and deletion blocker machinery:**
  `supersedes_deletion_evidence_ref`, append-only unverified-then-verified
  deletion evidence, a durable expiry job with restart catch-up and UTC-boundary
  tests, and an operator deletion path on the same boundary. Live privacy/security
  approval is not claimed.
- **G Task 6 — release-trust machinery:** an offline signed runner-release
  builder, a non-empty compile-time trust-anchor path, exact
  binary-digest/signature/build binding, a required-trust runner self-check, and
  pre-switch deploy/rollback verification. `release-trust:g6-check` exercises the
  path with synthetic ephemeral keys; no production key or live reviewer approval
  is claimed.
- **G Task 11 — recurring repository gate:** `acceptance:g-check` aggregates the
  Task 1–6 protocol/fixture/binding gates, readiness-record semantics,
  evidence-store persistence, promotion-refusal cases, and the seven controls'
  repository evidence checks, and runs inside `npm run ci`. It proves the
  repository machinery only; live control evidence, the 72-hour soak, dual
  approval, and the final gate append are separately gated by the signed
  acceptance decision and are not asserted by this check.

## Deliberately not implemented yet

- Live provisioning of the host and web processes behind TLS on a VM. The in-repo
  F templates and workflow are implemented, but required users, databases, keys,
  configs, DNS, Caddy, and the G-owned pilot readiness decision are external
  prerequisites.
- A live production environment or production operations. The implemented
  host/web surfaces are code and tests, not a running SaaS service.
- Hardware-backed key custody. Signing is real ML-DSA-65, but custody is
  self-hosted software custody, not a hardware security module.
- Acceptance of real customer source-derived evidence. The protocol's
  `environment-evidence-gate` defaults to `synthetic_demo` and blocks it until
  partner-pilot readiness controls are in place.
- G Task 6 live key provisioning/evidence/reviewer approval and G Tasks 7–10:
  remaining live control evidence, the 72-hour synthetic-only soak, dual
  approval, and the final gate append. `acceptance:g-check` proves the repository
  machinery in CI (Task 11), but a passing repository gate is not a gate raise —
  real customer source-derived evidence stays blocked until the live evidence
  exists and the signed decision appends the `partner_pilot_real_snippet_ready`
  gate.

This is intentional and documented, not an oversight — see
[Architecture Overview §7–8](./codeattest-architecture-overview.md#7-what-is-implemented-today)
and the [Support Guide](./codeattest-support-guide.md) for claim-safe language to
use when describing current scope.
