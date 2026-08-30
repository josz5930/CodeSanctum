# CodeAttest Support Guide

Status: Public-facing support and operations guide  
Audience: support engineers, solutions teams, reviewer operations, customer success  
Last updated: 2026-08-30

## 1. Purpose

This guide helps support and operations teams answer CodeAttest questions consistently, route issues to the correct owner, and avoid unsafe or overstated product claims.

Use this document together with:

- [Architecture Overview](./codeattest-architecture-overview.md)
- [Technical Architecture](./codeattest-technical-architecture.md)
- [Assurance Boundary](./codeattest-assurance-boundary.md)
- [Functional Requirements](./codeattest-functional-requirements.md)

## 2. Support Positioning

CodeAttest is a protocol-centered evidence workflow, not a generic vulnerability-management platform and not a certification product.

Support teams should describe it as:

- a scoped secure-code evidence workflow
- a bounded disclosure model
- a deterministic evidence and receipt chain
- an append-oriented review record
- a claim-safe evidence package for review and diligence conversations

Support teams should not describe it as:

- a guarantee that code is secure
- a full repository review by default
- a completed hosted SaaS platform unless the specific capability is actually deployed
- a SOC 2, ISO/IEC 27001, or DSS certification product
- proof that auditors, regulators, or customers must accept the output

## 3. Audience-Specific Short Answers

### For customer operators

CodeAttest lets the customer choose a review scope, review what evidence may leave the environment, and receive structured review evidence with explicit limitations.

### For technical evaluators

The repository is protocol-first. The strongest implemented areas today are artifact schemas, canonical identities, local runner flows, intake verification, review-state domain logic, and static evidence projection helpers.

### For evidence consumers

The output is intended to be an evidence package that explains scope, methods, findings, validation, and limitations. It is not a certification statement.

## 4. Ownership Boundaries

Use the following routing model when triaging issues.

| Area | Typical issue types | Primary owner |
| --- | --- | --- |
| `protocol/` | schema mismatch, fixture drift, identity rules, canonicalization, invariant interpretation | protocol engineering |
| `runner/` | local CLI flow, scope capture, scan configuration, disclosure policy, manifest preview, local bundle preparation | runner engineering |
| `services/intake/` | submission verification, approved-versus-received mismatch, receipt eligibility, receipt generation rules | intake engineering |
| `services/worker/` | candidate finding normalization, grouping, evidence availability handling | review-processing engineering |
| `services/host/` | boot ladder, health/readiness, submission transport, auth/session routes, read-only web routes, loopback binding | host/platform engineering |
| `apps/control-plane/` | review-event semantics, evidence lifecycle controls, classification/remediation/verification state logic | control-plane engineering |
| `apps/web/` | web rendering of UI contracts, login/session flow, escaping, claim-safe copy | UI/platform engineering |
| `packages/ui/` | view-contract rendering semantics, accessibility metadata, claim-safe state presentation | UI/platform engineering |
| `packages/static-bundle/` | static bundle projection, finalization, export posture, offline portal structure | export/platform engineering |
| `packages/evidence-store/` | persistence adapters, append-only grants, access logging, artifact byte storage, job queue | persistence/platform engineering |
| `packages/identity-store/` | accounts, sessions, TOTP, throttling, submission credentials | identity/platform engineering |
| `packages/signing/` | ML-DSA-65 signing/verification helpers, key custody model | security/platform engineering |
| `docs/` | architecture wording, claim-safe phrasing, audience messaging | product/docs with engineering review |

## 5. Common Question Patterns

### "Does CodeAttest store my full repository?"

Recommended answer:

CodeAttest is designed around a bounded evidence workflow, not default full-repository upload. The customer-side runner prepares a scoped evidence package, and the Disclosure Policy plus Outbound Manifest are meant to show what is and is not included.

Avoid saying:

"No source code ever leaves the environment."

Reason:

Some coverage modes may include approved snippets or targeted files. The correct statement is that disclosure is bounded and explicitly reviewed, not that source-derived evidence is categorically impossible.

### "Is the Vendor Receipt proof that the code is secure?"

Recommended answer:

No. The Vendor Receipt proves what CodeAttest received and verified at intake. It is a receipt and integrity checkpoint, not a security guarantee.

### "Does a passed verification mean the whole application is fixed?"

Recommended answer:

No. Verification is scoped to selected findings, submitted follow-up evidence, and recorded validation criteria. It is not a fresh full review unless separately scoped.

### "Is this a hosted product today?"

Recommended answer:

The repository implements protocol contracts, persistence and session adapters, submission transport, an authenticated host, and a read-only web application. It is not an always-on production service yet: TLS delivery, operational provisioning/monitoring, hardware-backed custody, and the real-evidence gate remain deferred.

### "Can we accept real customer snippets now?"

Recommended answer:

Not by default. The codebase keeps an explicit synthetic-demo evidence boundary and requires additional evidence-handling readiness gates before real source-derived evidence can be accepted.

## 6. Safe Language Rules

Use language like:

- "supports"
- "records"
- "verifies"
- "projects"
- "references"
- "documents"
- "helps evidence"
- "bounded"
- "scoped"
- "claim-safe"

Avoid language like:

- "certifies"
- "guarantees"
- "proves secure"
- "independently assures"
- "fully compliant"
- "auditor-approved"
- "regulator-approved"
- "complete review of the entire codebase"

## 7. Triage Checklist

When a support issue arrives, confirm:

1. Which artifact or workflow stage is affected.
2. Whether the issue is local-runner side, vendor-intake side, review-state side, or export side.
3. Whether the problem is schema or identity related, logic related, or wording related.
4. Whether the customer is asking for current behavior, planned behavior, or a guarantee the product should not make.
5. Whether the issue involves source-derived evidence handling and therefore needs extra caution.

## 8. Stage-Based Troubleshooting Model

### Scope and scan stage

Look at:

- review-scope generation
- scanner configuration
- selected application path
- selected commit validity
- manifest and dependency detection limits

Likely owners:

- runner engineering

### Disclosure and manifest stage

Look at:

- disclosure policy mode
- snippet cap and redaction settings
- included and excluded evidence categories
- manifest identity and preview state

Likely owners:

- runner engineering
- protocol engineering if identities or schema semantics are disputed

### Bundle and receipt stage

Look at:

- bundle manifest identity
- signature envelope metadata
- approved-versus-received mismatch
- evidence gate posture
- receipt timestamp or signing metadata

Likely owners:

- intake engineering
- runner engineering if the bundle was malformed before submission

### Review-state stage

Look at:

- review-event ordering
- idempotency or supersedes conflicts
- classification/remediation/verification record references
- visibility and customer-facing projection rules

Likely owners:

- control-plane engineering
- protocol engineering when artifact interpretation is unclear

### Export and static package stage

Look at:

- static bundle identity
- finalization state
- evidence visibility and export posture
- deleted-evidence references
- customer-facing projection completeness

Likely owners:

- static-bundle engineering
- control-plane engineering when source records are inconsistent

## 9. Escalation Conditions

Escalate immediately when:

- a customer asks for a security or compliance guarantee
- a response would require interpreting legal, audit, or certification status
- real customer source-derived evidence handling is involved
- protocol identity or schema mismatches affect multiple layers
- evidence visibility, deletion, or retention behavior appears inconsistent
- customer-facing output may expose internal-only notes or hidden records

## 10. Response Templates

### Scope clarification

"CodeAttest is designed for scoped secure-code evidence, not an implied full review of every code path or deployed environment. The relevant record for scope is the review scope plus the approved outbound manifest."

### Receipt clarification

"The Vendor Receipt confirms what was received and verified at intake. It should not be read as a claim that the application is secure or fully reviewed."

### Verification clarification

"Verification is tied to selected findings and submitted follow-up evidence. It does not, by itself, represent a fresh end-to-end secure-code review."

### Hosted-capability clarification

"This repository contains the protocol, submission, persistence, session, host, and read-only web implementation, but it is not yet provisioned as an always-on production service."

## 11. What Support Should Read First

- For overall product shape: [Architecture Overview](./codeattest-architecture-overview.md)
- For implementation boundaries: [Technical Architecture](./codeattest-technical-architecture.md)
- For safe external wording: [Assurance Boundary](./codeattest-assurance-boundary.md)
- For public scope definitions: [Functional Requirements](./codeattest-functional-requirements.md)
