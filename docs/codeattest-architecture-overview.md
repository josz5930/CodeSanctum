# CodeAttest Architecture Overview

Status: Public-facing architecture summary  
Audience: customer operators, security leads, technical buyers, investors  
Last updated: 2026-08-30

CodeAttest is open source under the [GNU General Public License v3.0](../LICENSE) (GPLv3).

## 1. What CodeAttest Is

CodeAttest is a protocol-centered secure-code evidence workflow for teams that want scoped review evidence without defaulting to full repository upload.

The product is built around a simple operating model:

1. The customer defines the review scope inside their own environment.
2. The customer decides what evidence may leave that environment.
3. CodeAttest verifies exactly what was received.
4. Reviewers record structured findings, limitations, and follow-up evidence.
5. The final output is a claim-safe evidence package, not a certification claim.

## 2. Core Design Principle

The repository is organized around protocol artifacts rather than ad hoc service-specific data models.

That means CodeAttest tries to keep the same identity and meaning for:

- review scope
- disclosure policy
- outbound manifest
- evidence bundle
- vendor receipt
- review events
- finding records
- verification records
- attestation and export artifacts

This reduces ambiguity between the customer-side runner, vendor-side processing, reviewer tools, and final evidence exports.

## 3. The Main Actors

### Customer operator

The customer operator runs the Local Runner inside the customer environment. This actor chooses the application and commit under review, configures disclosure settings, reviews the outbound manifest, and explicitly approves what may be sent.

### CodeAttest intake and review systems

The vendor side verifies the submitted evidence bundle, records a Vendor Receipt when verification succeeds, normalizes scanner findings, and manages append-oriented review records.

### CodeAttest reviewer

The reviewer does not rewrite scanner output into hidden internal state. Instead, the reviewer records explicit classifications, remediation guidance, validation paths, false-positive decisions, accepted-risk records, and verification outcomes against protocol-backed artifacts.

### Evidence consumer

The final evidence package is meant for evidence consumers such as customer security teams, compliance teams, auditors, or investors. They inspect the final package; they do not need to operate the Local Runner.

## 4. High-Level System Shape

CodeAttest is organized as a set of architecture layers:

| Layer | Responsibility |
| --- | --- |
| Protocol | Defines schemas, identities, canonicalization rules, fixtures, and invariants |
| Local Runner | Runs in the customer environment and prepares customer-approved evidence |
| Intake | Verifies submitted bundles and issues Vendor Receipts when verification succeeds |
| Review and control plane logic | Models review history, evidence lifecycle, findings, verification, and attestation-related records |
| Persistence tier | Durable, append-only, access-logged storage ports with memory and Postgres/filesystem adapters |
| Identity tier | Accounts, sessions, TOTP, and runner submission credentials, kept off the evidence boundary |
| Signing | Real ML-DSA-65 signing and verification helpers used across receipts, decisions, and attestations |
| HTTP host | A loopback Fastify composition root: fail-closed boot, submission transport, auth, and read-only web routes |
| Shared UI contracts | Produces serializable view models rendered by the web surface and static exports |
| Web application | A Next.js App Router surface rendering the UI contracts against the host's read-only routes |
| Static evidence export | Projects signed static bundle and offline portal content from protocol-backed records |

## 5. Evidence Flow

The architecture follows a bounded evidence flow rather than a default upload-everything model.

### Step 1: Review scope

The Local Runner records the selected application, selected commit, repository identity hash, and available technical context.

### Step 2: Local scanner inputs

Configured local scanners produce Candidate Findings. These are scanner outputs only and are not yet expert review findings.

### Step 3: Disclosure policy

The customer defines what evidence categories may leave the local environment. Coverage mode, snippet limits, redaction metadata, and retention posture are all recorded explicitly.

### Step 4: Outbound manifest preview

Before any send action, the customer sees a manifest that explains what is included, what is excluded, and what disclosure tradeoffs apply.

### Step 5: Explicit approval and local bundle preparation

After review, the customer explicitly approves the send action and the runner constructs a deterministic evidence bundle with stable identifiers and signature metadata.

### Step 6: Intake verification and receipt

The intake boundary verifies the submitted bundle against protocol expectations, signing metadata, and approved-versus-received consistency checks. If verification succeeds, CodeAttest can issue a Vendor Receipt. If verification fails, the submission is rejected or quarantined without a receipt.

### Step 7: Review lifecycle

Review logic normalizes findings, records classification decisions, remediation guidance, validation paths, verification evidence, and other review events in an append-oriented history.

### Step 8: Evidence package and export

The system can project claim-safe customer-facing finding records, verification addenda, signed static bundle content, and Attestation-related artifacts for evidence consumers.

## 6. Architecture Boundaries That Matter

### Protocol-first boundary

The protocol is the product truth center. Services and UI layers consume protocol contracts; they do not redefine protocol meaning independently.

### Customer-environment boundary

The Local Runner is intentionally customer-side. It prepares evidence locally and gives the customer a chance to inspect and approve disclosure before evidence leaves the environment.

### Append-only review boundary

Review history is modeled as append-oriented events. Corrections are recorded as new events that supersede older ones rather than rewriting history in place.

### Claim-safe communication boundary

The architecture is designed to support bounded evidence claims. It is not designed to claim that CodeAttest certifies code, proves absence of vulnerabilities, or replaces auditors or compliance programs.

### Evidence-handling boundary

The current repository remains explicit about evidence-handling limits. The default posture is synthetic-demo-safe. Real customer source-derived evidence requires additional readiness gates for access control, logging, encryption, retention, and deletion controls.

## 7. What Is Implemented Today

The current repository already implements substantial protocol and processing logic:

- protocol schemas, fixtures, canonicalization helpers, invariants, and a protocol-owned claim-safety enforcement policy
- a Rust Local Runner scaffold with scope, scan, disclosure, manifest, approval, bundle preparation, and local trust/status flows
- TypeScript intake verification and Vendor Receipt logic
- worker-side finding normalization
- control-plane logic for evidence lifecycle events, review history, classification, remediation, verification, and Attestation record handling
- real ML-DSA-65 signing and verification helpers
- a durable persistence tier: append-only, access-logged storage ports with memory and Postgres/filesystem adapters, history enforced by database role grants
- an identity tier for accounts, opaque sessions, TOTP, and runner submission credentials
- a loopback Fastify host with a fail-closed boot ladder, submission transport, authenticated sessions, scoped evidence access, and read-only web projections
- a Next.js web application rendering the review, finding, verification, Attestation, and static-bundle contracts
- UI contracts as serializable objects
- static bundle and offline portal projection helpers

## 8. What Is Deliberately Deferred

The repository is careful not to overclaim hosted behavior that is not yet present.

Deferred or explicitly out-of-scope implementation areas include:

- full hosted SaaS runtime
- live production provisioning of the implemented authentication, database, and object-store adapters
- queue-based background processing
- hardware-backed production key custody (current custody is self-hosted software custody)
- always-on web application delivery
- acceptance of real customer Raw Snippets before evidence-handling gates are raised

## 9. Why This Architecture Exists

This design is meant to solve a specific problem: many teams want secure-code review evidence, but cannot default to uploading their full repository to a third-party platform.

CodeAttest answers that with:

- customer-selected scope
- explicit disclosure control
- deterministic artifact identities
- approved-versus-received verification
- append-oriented review records
- claim-safe evidence outputs

## 10. Recommended Reading

- For technical detail, see [Technical Architecture](./codeattest-technical-architecture.md).
- For claim-safe wording, see [Assurance Boundary](./codeattest-assurance-boundary.md).
- For support and triage guidance, see [Support Guide](./codeattest-support-guide.md).
