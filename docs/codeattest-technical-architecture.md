# CodeAttest Technical Architecture

Status: Public-facing technical architecture reference  
Audience: engineers, AppSec evaluators, technical diligence teams, support engineers  
Last updated: 2026-08-30

CodeAttest is open source under the [GNU General Public License v3.0](../LICENSE) (GPLv3).

## 1. Repository Shape

CodeAttest is a multi-part monorepo with TypeScript and Rust components organized around protocol contracts.

Top-level areas:

| Path | Role |
| --- | --- |
| `protocol/` | Product-truth center for schemas, fixtures, identities, canonicalization rules, and protocol docs |
| `runner/` | Rust Local Runner that executes inside the customer environment |
| `services/intake/` | TypeScript intake verification and Vendor Receipt boundary |
| `services/worker/` | TypeScript finding normalization boundary |
| `services/host/` | Fastify composition root: fail-closed boot ladder, health/readiness, submission transport, auth/session, and read-only web routes (loopback only) |
| `apps/control-plane/` | TypeScript review-event, evidence-lifecycle, verification, and Attestation-related logic |
| `apps/web/` | Next.js App Router surface that renders `packages/ui` contracts against the host's read-only routes |
| `packages/protocol-ts/` | Generated and validated TypeScript bindings/helpers derived from protocol artifacts |
| `packages/ui/` | Dependency-light serializable view contracts for receipt, review, verification, and export surfaces |
| `packages/static-bundle/` | Signed static bundle and offline portal projection helpers |
| `packages/evidence-store/` | Durable persistence ports and memory/Postgres/filesystem adapters for the pure library tier |
| `packages/identity-store/` | Accounts, sessions, TOTP, and runner submission credentials with memory/Postgres adapters |
| `packages/signing/` | ML-DSA-65 signing and verification helpers |
| `scripts/` | Quality gates, drift checks, fixture checks, and story-specific validation scripts |
| `infra/` | Local-dev / demo-cloud docs, database migrations, and delivery templates (not a live stack) |
| `docs/` | Public-facing planning and architecture documentation |

## 2. Architectural Invariants

The repository consistently enforces a small set of architectural rules.

### Protocol is the authority

`protocol/` defines artifact meaning. Other areas may validate, project, or transport protocol artifacts, but they must not redefine protocol semantics.

### Dependency direction is inward toward protocol

The intended direction is:

`protocol/` -> no runtime dependency on product adapters  
`packages/protocol-ts/` -> derives from protocol  
`runner/`, `services/`, `apps/`, `packages/static-bundle/`, `packages/ui/` -> depend on protocol contracts

The repository root README states this explicitly, and `scripts/check-dependency-direction.mjs` is part of the quality gate surface.

### Append-oriented history

Audit-significant state is modeled as append-oriented events and typed records. Corrections use `supersedes_event_id` or higher-version records, not in-place mutation.

### Explicit evidence classes

Evidence-handling logic consistently attaches source-derived and retention classes, including cases where evidence is never collected, retained as a review artifact, transient, or deleted under policy.

### Claim-safe outputs

UI contracts, static bundle projections, and evidence-facing copy are designed to reject or avoid unsafe claims, raw source leakage, or silent elevation of scanner output into expert conclusions.

## 3. Component Responsibilities

### 3.1 Protocol layer

`protocol/` contains:

- JSON Schema 2020-12 contracts in `protocol/schemas/`
- canonical fixtures in `protocol/fixtures/`
- protocol notes in `protocol/docs/`
- claim-safety enforcement policy in `protocol/policies/` (currently `claim-safety.v0.json`)
- configuration in `protocol/gate.config.json`

This layer owns:

- artifact shapes
- invariant definitions
- canonical identity rules
- claim-safety policy as the single source of truth for forbidden phrases, PII patterns, and positive-closure language
- schema registration inputs
- public fixture examples

`protocol/docs/protocol-invariants.md` and related documents act as the shared semantic spine across Rust and TypeScript implementations.

### 3.2 TypeScript protocol package

`packages/protocol-ts/` exports:

- generated protocol types
- schema validation helpers
- canonical identity helpers
- claim-safety helpers derived from `protocol/policies/claim-safety.v0.json`
- ML-DSA-65 signing/verification helpers

This package is generated-from-protocol rather than being protocol authority itself. Generated output under `src/generated/` — including `protocol-v0.ts`, `protocol-v0-schemas.ts`, and `claim-safety-policy.ts` — is generator-owned and derives from protocol schemas and policies.

### 3.3 Customer-side runner

The Rust runner crate lives at `runner/crates/local-runner-scaffold/`.

It currently implements customer-side flows for:

- `scope init`
- `scan run`
- `disclosure configure`
- `manifest preview`
- `bundle prepare`
- `bundle status`
- `runner trust`

Key technical traits:

- customer-environment execution
- deterministic JSON/canonicalization behavior
- explicit local-only bundle preparation
- review-scope and manifest identity validation
- stage-aware local attempt and status reporting
- no hosted submission or receipt issuance in the runner itself

The runner code exposes an explicit `synthetic-demo-only` evidence boundary and a typed `EnvironmentEvidenceGate` that must be raised before real source-derived evidence is acceptable.

### 3.4 Intake boundary

`services/intake/src/index.ts` implements pure verification and receipt logic.

Primary entry points:

- `verifyIntakeSubmission(request)`
- `generateVendorReceipt(request)`
- `verifyVendorReceiptRecord(receipt)`
- `buildSubmissionOutcome(request)`

Key responsibilities:

- verify protocol version and schema shape
- recompute canonical identities
- compare approved versus received manifest and bundle values
- validate real ML-DSA-65 signature metadata against a verified signature outcome
- enforce environment evidence gate posture
- return claim-safe rejected or quarantined outcomes when verification fails

This boundary is intentionally pure: no HTTP server, database, queue, object store, or framework runtime is required by the core service API.

### 3.5 Worker boundary

`services/worker/src/index.ts` implements `normalizeCandidateFindings(input)`.

This logic:

- consumes already-received protocol artifacts
- groups candidate findings into review-ready draft structures
- preserves scanner provenance, severity, confidence, and evidence availability
- refuses to treat scanner output as expert classification

It explicitly does not:

- execute scanners
- read the filesystem
- write to storage
- mutate review history
- mint receipts

### 3.6 Control-plane boundary

`apps/control-plane/src/index.ts` is the largest TypeScript boundary and models the review-state core.

Examples of responsibilities already implemented there:

- append-only review-event log semantics
- evidence storage classification and access controls
- retention opt-in and deletion event handling
- submission outcome event generation
- classification, remediation, validation, accepted-risk, and false-positive event builders
- verification-scope, evidence-intake, decision, and addendum logic
- Epic 5 Attestation, supporting-evidence, static bundle, and pilot-learning event handling

Technical posture:

- pure functions over typed inputs
- runtime validation
- deep-copy return values to prevent caller mutation after validation
- explicit reason codes for rejected operations
- claim-safe text filtering and visibility rules

This remains the pure domain-logic boundary. `services/host` exposes the API
surface and `apps/web` renders its projections; neither moves framework or I/O
concerns into `apps/control-plane`.

### 3.7 UI contract layer

`packages/ui/` exports serializable view contracts for:

- receipt and review state primitives
- review history
- failed submission notices
- classification workbench views
- customer-facing finding record views
- verification scope, intake, decision, and addendum views
- Attestation builder, finalization, supporting-evidence, static bundle, and pilot-learning views

`apps/web` maps these contracts to React DOM. The separation still matters: UI
semantics remain framework-agnostic and protocol-derived, while the Next.js
workspace is a thin escaping/rendering adapter.

### 3.8 Static bundle layer

`packages/static-bundle/` projects customer-facing export content from validated protocol records.

Current scope includes:

- finding outcome sections
- verification pass scope projection
- verification addendum projection
- static bundle generation and finalization helpers
- static portal generation helpers
- supporting-evidence mapping projection

The package is structured to fail closed for malformed, hidden, deleted, or claim-unsafe input.

### 3.9 Signing helpers

`packages/signing/` provides the real ML-DSA-65 signing and verification helpers used by the runner-signature verification, Vendor Receipt, decision-signing, and Attestation paths. Key custody today is self-hosted software custody (managed-key and enrolled-runner-key models), not a hardware security module.

### 3.10 Persistence tier

`packages/evidence-store/` gives the pure library tier a durable place to live without the pure functions ever importing a database, filesystem, or queue directly. It exposes seven ports — append-only review-event and evidence-lifecycle logs, a content-addressed artifact store, write-once classification and retention records, an append-only versioned environment gate, insert-only readiness records, and a job queue — each with a memory adapter and a durable adapter (Postgres for records, content-addressed filesystem for artifact bytes), proven identical by one shared contract suite. Append-only history is enforced by Postgres role grants rather than application convention; artifact bytes are unreadable without an allowed access decision whose lifecycle event is persisted in the same operation that returns the bytes. This is the only `@onevps/*` workspace permitted to import a database client and Node core I/O.

### 3.11 Identity tier

`packages/identity-store/` holds operator-provisioned accounts, opaque sessions, login throttling, TOTP enrollment, and runner submission credentials behind memory and Postgres adapters over one shared port suite. Nothing here is a protocol artifact: identifiers, hashes, session handles, and credential material stay on this side of the evidence boundary. Every identity table is append-only, enforced by role grants; passwords use scrypt and enrollment secrets are AES-256-GCM boxed.

### 3.12 HTTP host

`services/host/` is the Fastify composition root that turns the persistence and identity ports into a running process. It boots through a fail-closed ladder (config, migration-head check, environment-gate binding, object-store verification, a database grant self-test, then serving) and refuses to start if any step fails. It exposes `/healthz` and `/readyz` (the latter reflecting live database reachability), the three-phase submission transport (`POST /v0/submissions`, per-artifact `PUT`, and `finalize`), opaque-session auth with optional TOTP, scoped and logged evidence access, and authenticated read-only web projections. It binds to loopback only; it terminates no TLS and is not internet-exposed.

### 3.13 Web application

`apps/web/` is a Next.js App Router surface that maps `packages/ui` view contracts to React DOM. Server Components fetch the host's read-only routes (forwarding the session cookie) and render dashboard, review, finding, verification, Attestation, finalization, supporting-evidence, and static-bundle surfaces. It renders all text through React's default escaping, never writes, and never exposes the internal-only pilot-learning contract. It may depend on `@onevps/ui` and `@onevps/protocol-ts` only.

## 4. End-to-End Artifact Flow

The intended artifact flow is:

1. `review-scope`
2. `scanner-finding-set`
3. `disclosure-policy`
4. `outbound-manifest`
5. `customer-approval`
6. `bundle-manifest` plus signature envelope
7. intake verification result
8. `vendor-receipt`
9. `review-finding-draft-set`
10. review event log plus typed finding and verification artifacts
11. `security-review-attestation`
12. `static-bundle-manifest` and static portal projections

This sequencing is reflected across runner docs, intake code, worker logic, control-plane builders, and static bundle projections.

## 5. Evidence Boundary and Deployment Maturity

The most important architecture caveat is that the repository is ahead in protocol and pure-domain modeling, but deliberately behind in hosted runtime deployment concerns.

Implemented well today:

- protocol contracts
- deterministic identity rules
- schema validation
- real ML-DSA-65 signing model (managed-key and enrolled-runner-key custody)
- bundle and receipt verification logic
- append-oriented review history semantics
- typed evidence lifecycle logic
- quality gates and fixture drift checks

Implemented as code and tests, but not provisioned as a live production service:

- Fastify network ingress and submission/read APIs
- opaque-session authentication, optional TOTP, and scoped authorization
- Postgres/filesystem persistence and a job-queue adapter
- the Next.js customer/reviewer read surface

Still not represented as completed production capabilities:

- production KMS or HSM key custody
- production secrets handling
- always-on TLS delivery, monitoring, and operational provisioning

Any technical diligence conversation should distinguish carefully between implemented domain logic and deferred service deployment work.

## 6. Quality Gates

The root npm workspace is the canonical command surface.

Core commands from `package.json`:

- `npm run format`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run protocol:check`
- `npm run fixtures:drift`
- `npm run fixtures:coverage`
- `npm run bindings:check`
- `npm run jcs:check`
- `npm run ci`

The `ci` aggregate also includes:

- workspace-boundary, dependency-direction, public-content-safety, and runner-artifact lint gates
- Rust format, lint, build, and test gates when Cargo is available
- story-specific schema, protocol, and boundary checks spanning Epics 1–5 (runner schema checks, protocol trust prerequisites, intake, control-plane, worker, and static-bundle story gates)
- canonicalization (JCS), fixture drift, fixture coverage, and generated binding drift checks

This gate posture is part of the architecture: protocol correctness and cross-language consistency are enforced as build-time invariants rather than left to ad hoc runtime behavior.

## 7. Public and Private-Capable Boundaries

The root README draws a line between areas intended to be public/open and areas that may remain private-capable.

Intended public/open:

- `protocol/`
- `runner/`

Private-capable:

- `apps/`
- `services/`
- `packages/`
- `infra/`

This split matches the product model: protocol and customer-side runner behavior can be publicly scrutinized, while vendor operational surfaces may remain proprietary.

## 8. Risks and Architecture Implications

### Risk: overclaiming hosted readiness

Because the repository contains rich domain logic, it is easy to overstate product completeness. Public docs should continue to distinguish pure service boundaries from deployed cloud systems.

### Risk: evidence-boundary drift

The code repeatedly enforces synthetic-demo restrictions. Any future change that accepts real source-derived evidence must raise the corresponding evidence-handling controls across storage, access, logging, retention, and deletion.

### Risk: semantic duplication

The architecture only stays coherent if protocol meaning remains centralized. Re-implementing protocol semantics independently in services or UI would erode the main design benefit.

## 9. Recommended Use In Diligence

Use this document to explain:

- how the repository is partitioned
- which boundaries are real today
- where protocol authority lives
- how evidence flows across the system
- which controls are enforced through code and tests

Do not use this document to claim:

- a finished hosted control plane deployment
- production evidence-handling readiness for real customer source
- live customer authentication or storage controls already in service
- auditor acceptance or certification outcomes

## 10. Related Documents

- [Architecture Overview](./codeattest-architecture-overview.md)
- [Support Guide](./codeattest-support-guide.md)
- [Assurance Boundary](./codeattest-assurance-boundary.md)
