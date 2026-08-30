# CodeAttest Documentation Index

Status: Public-facing documentation hub  
Audience: customer operators, technical evaluators, support teams, design partners, investors  
Last updated: 2026-08-30

CodeAttest is open source under the [GNU General Public License v3.0](../LICENSE) (GPLv3).

## 1. Start Here

CodeAttest is a protocol-centered secure-code evidence workflow. The repository implements protocol contracts, a customer-side local runner, and dependency-light processing boundaries for intake verification, review-state handling, and static evidence projections, plus a durable persistence tier, an authenticated loopback HTTP host, and a Next.js read-only web surface delivered as code and tests.

This repository does **not** yet represent a live, always-on hosted SaaS deployment. The host and web surfaces exist as implemented, tested code, not as a provisioned production service. Public documentation should therefore describe the architecture as a protocol-first product foundation with clear boundaries, not as a finished cloud platform.

## 2. Read By Audience

### Customer operators and general end users

- [Architecture Overview](./codeattest-architecture-overview.md) explains the system in plain language, the major actors, and how evidence moves through the workflow.
- [Assurance Boundary](./codeattest-assurance-boundary.md) explains what CodeAttest is designed to show and what it does not claim.
- [Functional Requirements](./codeattest-functional-requirements.md) describes the intended partner-pilot product scope.

### Technical evaluators and engineering teams

- [Technical Architecture](./codeattest-technical-architecture.md) maps the repository structure, artifact flow, dependency direction, and quality gates to the current implementation.
- [Control Alignment Matrix](./codeattest-control-alignment.md) provides a conservative framework mapping for diligence discussions.
- [Production-Readiness Guide](./codeattest-production-readiness.md) lists the infrastructure, live evidence, approvals, and repository work still required before the pilot can accept real customer source-derived evidence.

### Support, solutions, and reviewer operations

- [Support Guide](./codeattest-support-guide.md) gives a triage model, ownership boundaries, safe language, and escalation guidance.
- [Assurance Boundary](./codeattest-assurance-boundary.md) is the primary reference for claim-safe external communication.
- [Functional Requirements](./codeattest-functional-requirements.md) helps support teams separate current partner-pilot scope from out-of-scope requests.

## 3. Core Document Set

| Document | Primary audience | Purpose |
| --- | --- | --- |
| [Architecture Overview](./codeattest-architecture-overview.md) | End users, security leads, investors | Plain-language explanation of the product structure and workflow |
| [Technical Architecture](./codeattest-technical-architecture.md) | Engineers, AppSec evaluators, technical diligence teams | Detailed repository and component reference |
| [Support Guide](./codeattest-support-guide.md) | Support, customer success, reviewer operations | Triage, ownership, safe wording, and escalation |
| [Assurance Boundary](./codeattest-assurance-boundary.md) | Customers, compliance, investors | Claim-safe summary of what CodeAttest does and does not assert |
| [Functional Requirements](./codeattest-functional-requirements.md) | Technical buyers, design partners | Public-facing partner-pilot requirements |
| [Control Alignment Matrix](./codeattest-control-alignment.md) | Compliance, audit-readiness, investors | Conservative control/support mapping |
| [Production-Readiness Guide](./codeattest-production-readiness.md) | Repository owner, pilot operator | Work remaining before real customer evidence can be accepted |
| [Partner-Facing Disclosures (DRAFT)](./codeattest-partner-disclosures-DRAFT.md) | Pilot partners, compliance teams | Draft retention, deletion, incident, and consent language, not yet in force |

## 4. Architecture At A Glance

- `protocol/` is the product-truth center. Schemas, canonicalization rules, fixtures, protocol invariants, and the claim-safety enforcement policy live there.
- `runner/` is the customer-side Rust boundary for scope selection, local scanning, disclosure policy, manifest preview, approval, and local bundle preparation.
- `services/intake/` verifies submitted bundles and issues Vendor Receipts as pure TypeScript service logic.
- `services/worker/` normalizes scanner outputs into reviewable finding drafts.
- `apps/control-plane/` models append-oriented review history, evidence lifecycle controls, verification, and Attestation-related records as pure TypeScript boundaries.
- `packages/ui/` provides serializable view contracts rather than a browser application.
- `packages/static-bundle/` projects signed static bundle and offline portal content from protocol-backed records.
- `packages/evidence-store/` holds durable persistence ports and their memory and Postgres/filesystem adapters for the pure library tier; append-only history is enforced by database role grants rather than convention.
- `packages/identity-store/` holds accounts, opaque sessions, TOTP enrollment, and runner submission credentials behind memory and Postgres adapters.
- `packages/signing/` holds the ML-DSA-65 signing and verification helpers used across the runner-verification, receipt, and attestation paths.
- `services/host/` is the Fastify composition root: a fail-closed boot ladder, health/readiness routes, three-phase submission endpoints, authenticated sessions, and read-only web projections, bound to loopback only.
- `apps/web/` is a Next.js App Router surface that renders `packages/ui` view contracts against the host's read-only routes.

## 5. Read Next

- If you need the high-level story first, read [Architecture Overview](./codeattest-architecture-overview.md).
- If you need the implementation and repository map, read [Technical Architecture](./codeattest-technical-architecture.md).
- If you need to answer customer or operator questions safely, read [Support Guide](./codeattest-support-guide.md).

## 6. Status Note

These documents describe the repository state as of 2026-08-30. They are suitable for technical diligence and architecture discussion, but they are not a legal opinion, SOC 2 report, ISO/IEC 27001 certification statement, DSS compliance attestation, or guarantee of customer, auditor, or regulator acceptance.
