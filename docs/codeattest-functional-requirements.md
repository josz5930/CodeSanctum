# CodeAttest Functional Requirements

Status: Partner-pilot specification  
Audience: AppSec, engineering, compliance, audit-readiness, investor diligence  
Last updated: 2026-08-30

## 1. Purpose

CodeAttest is a secure-code evidence workflow for teams that need expert review evidence but cannot or do not want to upload a full source repository to a third-party SaaS platform.

The product changes the disclosure model from "send the repository" to "review and approve a bounded evidence bundle." A customer-operated Local Runner prepares evidence inside the customer environment, the customer reviews an Outbound Manifest before anything is sent, CodeAttest verifies and receipts the submitted bundle, expert reviewers classify findings, and the customer receives a signed evidence package suitable for audit-support conversations.

CodeAttest is not a SOC 2 opinion, ISO/IEC 27001 certification service, DSS attestation service, or general vulnerability management platform. It is intended to produce structured supporting evidence for customer-controlled review contexts.

## 2. Primary Users

### 2.1 Customer AppSec Lead

The primary operator is a fintech or regulated-adjacent AppSec lead preparing evidence for audits, customer security reviews, internal governance, or risk conversations where third-party secure-code review evidence is useful and full repository disclosure is blocked or undesirable.

### 2.2 CodeAttest Reviewer

The reviewer is an AppSec expert who reviews submitted evidence, separates scanner output from expert judgment, classifies findings, writes remediation guidance, and records limitations when submitted evidence is insufficient.

### 2.3 Evidence Consumer

Evidence consumers include auditors, regulators, customer security reviewers, internal compliance teams, investors performing technical diligence, and other approved third parties. They inspect the final Attestation and selected supporting artifacts. They do not operate the Local Runner.

## 3. Functional Scope

### FR-1. Review Scope Selection

Customers must be able to select one application and one commit for a partner-pilot review. CodeAttest records the selected application, selected commit, repository identity hash, runner version, detected technical context, and dependency context where available.

The final Attestation must state the selected scope and any detection limitations.

### FR-2. Local Scanner Inputs

The Local Runner must execute configurable local scanner inputs, including MVP regex rules and Semgrep-based scanning for the initial TypeScript/JavaScript and Python pilot targets.

Scanner evidence must include scanner name, scanner version where available, ruleset identifier, execution timestamp, affected area, severity or priority when available, confidence when available, and structured Candidate Findings where possible.

Scanner output must not be treated as expert classification.

### FR-3. Disclosure Policy

Customers must be able to configure a Disclosure Policy for each review. The policy must cover metadata, dependency information, scanner findings, snippets, maximum snippet length or context size, redaction behavior, coverage mode, and retention preference.

The product must warn that stricter disclosure can reduce expert review confidence, and that Raw Snippets remain source-code disclosure even when capped or redacted.

### FR-4. Coverage Modes

CodeAttest must support exactly three partner-pilot coverage modes:

| Mode | Purpose | Disclosure posture |
|---|---|---|
| Metadata-only | Stricter disclosure by explicit customer choice | Lower expert confidence expected |
| Finding-context snippets | Default recommended starting mode for demo and partner-pilot workflows | Bounded snippets around candidate findings; balances review confidence and disclosure control |
| Extended approved snippets or targeted files | Broader approved source context by explicit customer choice | Explicit broader source-derived disclosure; still not a full-source review |

Every Attestation must state the selected coverage mode and its limitations.

### FR-5. Outbound Manifest Preview

Before transmission, the Local Runner must generate an Outbound Manifest that lists each included and excluded evidence category. It must show inclusion state, count or reference, source-derived status, redaction state, retention handling, limitations, and whether snippets or targeted files are included.

The preview must be readable by a technical AppSec lead without requiring CodeAttest support.

### FR-6. Explicit Customer Approval

No evidence may be transmitted until the customer has reviewed the manifest and explicitly approved sending the Evidence Bundle.

The approval record must capture approval timestamp and approving actor identifier when available. If approval is declined or cancelled, the review remains not submitted and no evidence is transmitted.

### FR-7. Evidence Bundle Construction and Signing

After approval, the Local Runner must create a deterministic Evidence Bundle containing the Outbound Manifest, review scope, Disclosure Policy, scanner metadata, Candidate Findings, approved evidence artifacts, runner version, and tool version metadata.

The bundle must expose stable identifiers, artifact digests, artifact type, size, source-derived class, retention class, manifest entry references, bundle instance identity, and submission attempt identity.

The runner must sign typed envelopes over canonical bundle identities and metadata rather than signing transport bytes. Signing uses the ML-DSA-65 profile; signing metadata records the selected profile and key custody model. Key custody today is self-hosted software custody, not a hardware security module.

### FR-8. Verified Vendor Intake

CodeAttest must ingest only customer-approved Evidence Bundles. Intake must verify accepted protocol version, canonical bundle identity, runner signature, bundle manifest digest, artifact digest matches, artifact classes allowed for the receiving environment, and review-scoped submission token or key.

Malformed or disallowed submissions must be rejected or quarantined without a Vendor Receipt.

### FR-9. Vendor Receipt

After successful intake verification, CodeAttest must issue a signed Vendor Receipt. The receipt must reference the Evidence Bundle identity, Outbound Manifest identity, receipt timestamp, receiving environment, signing key or key version where available, protocol version, and verification state.

The product must make it possible to compare what the customer approved with what CodeAttest received.

### FR-10. Review History

CodeAttest must maintain append-oriented review history for receipt, expert review, finding classification, validation, remediation decisions, Attestation generation, artifact retention, artifact deletion, and customer-facing history.

History events must include actor or service actor, timestamp, event type, artifact references, review identifier, and supersedes links where an event corrects or updates earlier state.

### FR-11. Finding Normalization

CodeAttest must normalize submitted scanner and evidence outputs into reviewable Findings. Findings must include identifier, source, affected area, evidence reference, severity when available, confidence when available, status, reviewer notes, and grouping for duplicate or related outputs.

Normalization must preserve evidence limitations and must not create expert classifications.

### FR-12. Expert Classification

Reviewers must be able to classify each Finding as one of:

- Confirmed
- Likely
- Inconclusive
- Requires customer-side validation

Each classification must record evidence basis, criteria, limitation, and reviewer rationale. Metadata-only or scanner-only findings must not be marked confirmed without recorded justification.

### FR-13. Remediation Guidance

Reviewers must be able to write remediation guidance for actionable Findings, including exploitability rationale where appropriate, suggested remediation, validation steps, limitations, and customer owner/status capture.

Customer remediation status must not rewrite expert classification history.

### FR-14. Validation Paths and Scripts

Where evidence is insufficient for confirmation, reviewers must be able to attach validation paths. Validation paths may include remote dynamic testing guidance where applicable, customer-run scripts or manual steps, and reviewer-authored Validation Scripts.

The partner-pilot package includes three Validation Scripts in the paid fixed-scope base package. Additional scripts may be separately priced and should be marked as such until pricing is finalized.

### FR-15. False Positive and Accepted Risk Records

The product must support false-positive and accepted-risk records. False positives must include reviewer rationale. Accepted risk must include customer sign-off or explicit rationale where available.

These records must remain visible in the Attestation and supporting evidence package.

### FR-16. Remediation Verification Pass

The partner-pilot workflow must support one remediation verification pass for customer-selected findings within 30 days. Verification must reference a follow-up commit or customer-provided validation record, record before/after status, and state remaining limitations.

Verification must not imply a complete new secure-code review unless separately scoped.

### FR-17. Security Review Attestation

CodeAttest must generate a Security Review Attestation for completed reviews. The Attestation must include executive summary, scope, method, selected commit, scan date, runner version, scanner versions, detected languages/frameworks, Disclosure Policy summary, coverage mode, Outbound Manifest reference, Evidence Bundle reference, Vendor Receipt, Findings, classifications, validation paths, remediation status, false positives, accepted risk, limitations, Deletion Evidence, appendices, and claim-safe supporting-evidence language.

The Attestation must be readable by technical customers and evidence consumers, not only by CodeAttest staff.

### FR-18. Supporting-Evidence Control Mapping

The Attestation or companion evidence package may include mapping to SOC 2, ISO/IEC 27001, DSS, regulatory themes, and customer-security-review questions.

All mappings must be worded as supporting evidence, not proof of control satisfaction, certification, regulatory approval, or auditor acceptance.

### FR-19. Signed Static Bundle and Static Portal

Customers must be able to share a Signed Static Bundle with approved third parties. The bundle must include the Attestation and selected supporting artifacts, with manifest, digest, signature, receipt, and verification metadata.

An optional Generated Static Portal may provide offline document navigation for overview, scope, receipt chain, methods, findings, validation/remediation, limitations, and appendices.

Evidence consumers must not need to operate the Local Runner or maintain a live CodeAttest SaaS session to inspect the shared package.

### FR-20. Pilot Metrics

CodeAttest must record internal partner-pilot metrics needed to decide whether the model works, including classification yield, time per finding, expert review hours, validation-script hours, turnaround, disclosure mode selected, snippet rejection rate, evidence-consumer usefulness feedback, and customer willingness to repeat or pay.

Internal unit economics and unapproved partner feedback must stay out of public customer artifacts unless explicitly approved.

## 4. Non-Functional Requirements

### Security and Privacy

- Received snippets, findings, manifests, receipts, review artifacts, and validation evidence must be treated as sensitive customer security data.
- Vendor-side evidence storage must have access control, encryption at rest, access logging, and deletion controls before real customer Raw Snippets are accepted.
- Logs, queues, traces, analytics, crash reporting, error reporting, and support attachments must not leak Raw Snippets or sensitive evidence.
- The Local Runner must operate with documented least-privilege expectations.

### Evidence Integrity

- Evidence identities, runner version, scanner versions, Disclosure Policy, Outbound Manifest, Evidence Bundle identity, and Vendor Receipt must be preserved in the review record.
- CodeAttest must support approved-versus-received comparison.
- Failed submissions must not create ambiguous received states.
- Re-submission after failure must create a distinct attempt identity rather than silently overwriting a prior record.

### Retention and Deletion

- Raw snippet retention defaults to no retention after analysis and report generation unless the customer explicitly opts into a defined retention period.
- Temporary source-derived files, transient scanner output, queue payloads, worker scratch space, generated exports, and support attachments must be non-sensitive by construction or covered by the same controls as Review Artifacts.
- Deletion controls and Deletion Evidence are required before accepting real customer snippets.
- Evidence references must resolve to retained artifacts or explicitly state that source-derived content was deleted under policy.

### Usability and Accessibility

- The Outbound Manifest must be readable by a technical AppSec lead without support.
- Warnings about snippet disclosure and lower-confidence metadata-only review must be explicit before approval.
- Web and static portal surfaces should meet WCAG 2.2 AA-oriented expectations, including visible focus, keyboard navigation, status text, screen reader-friendly state changes, Reduce Motion support, and touch targets appropriate for modern devices.
- CLI output must remain usable in monochrome terminals.

### Claim-Safe Communication

- CodeAttest must not imply that it issues a SOC 2 opinion, CPA assurance report, ISO/IEC 27001 certification, regulatory certification, or guarantee of auditor acceptance.
- Public copy must avoid unqualified terms such as independent assurance unless qualified professionals confirm the claim is supportable in the target audit context.
- The Attestation must document scope, methods, evidence received, procedures performed, classifications, validation steps, limitations, and receipt chain.

## 5. Initial Architecture Expectations

- Protocol artifacts are the product truth. Product surfaces and infrastructure are adapters around protocol contracts.
- The Local Runner is Rust and owns customer-environment scan orchestration, disclosure policy application, manifest preview, deterministic bundle construction, signing, and submission.
- Vendor services and web/control-plane surfaces are TypeScript and own intake, review workbench, Attestation generation, static bundle generation, and customer/evidence-consumer web surfaces.
- Protocol contracts use JSON Schema 2020-12, canonical JSON behavior, stable artifact identifiers, and shared fixtures across Rust and TypeScript.
- Review history is append-oriented.
- Every artifact, event payload, queue payload, export, and static bundle artifact declares a retention/source-derived class.

## 6. Out of Scope for Partner Pilot

- Full repository upload as the default review path.
- General vulnerability management dashboard.
- SAST replacement claims.
- SOC 2 opinion, ISO/IEC 27001 certification, DSS certification, CPA assurance, regulatory approval, or guaranteed auditor acceptance.
- Mature enterprise procurement features such as complex RBAC, enterprise SSO, multi-application portfolio management, or persistent hosted evidence-consumer portal unless separately scoped.
- Payment processing inside the product surface for v1.

## 7. Customer Evidence Artifacts

| Artifact | Purpose |
|---|---|
| Review Scope | Selected application, selected commit, repository identity hash, runner version, detected technical context. |
| Disclosure Policy | What evidence categories may leave the customer environment, with coverage mode, redaction, snippet, and retention choices. |
| Outbound Manifest | Human-readable and machine-readable preview of evidence to be sent. |
| Evidence Bundle | Customer-approved signed package submitted to CodeAttest. |
| Vendor Receipt | Signed proof of the exact bundle CodeAttest received. |
| Review Event History | Append-oriented record of receipt, review, classification, validation, retention, deletion, and generation events. |
| Finding Records | Expert classification, evidence basis, remediation guidance, validation path, limitations, false-positive and accepted-risk outcomes. |
| Deletion Evidence | Evidence that transient source-derived artifacts were deleted under policy where applicable. |
| Security Review Attestation | Claim-safe summary and supporting evidence package for the selected review. |
| Signed Static Bundle | Customer-controlled export for approved third-party inspection. |

## 8. Public Review Caveat

This document is suitable for technical diligence and customer discovery. It is not a contract, audit report, certification statement, or substitute for a final Statement of Work. Framework mappings are provided in [Control Alignment Matrix](./codeattest-control-alignment.md) as preliminary supporting-evidence mappings and should be reviewed with customer auditors and counsel before use in formal compliance submissions.

## 9. Crosswalk to Internal PRD Functional Requirements

The `FR-1…FR-20` numbering in this document is a public-facing compression of the internal PRD's `FR1…FR23`. The internal PRD is the source of truth; this table lets a reader trace each public requirement back to the underlying PRD requirement(s).

| Public FR (this document) | PRD FR (internal) |
|---|---|
| FR-1 Review Scope Selection | FR1, FR3 |
| FR-2 Local Scanner Inputs | FR2 |
| FR-3 Disclosure Policy | FR4, FR5, FR9 |
| FR-4 Coverage Modes | FR8 |
| FR-5 Outbound Manifest Preview | FR6 |
| FR-6 Explicit Customer Approval | FR7 |
| FR-7 Evidence Bundle Construction and Signing | FR10 |
| FR-8 Verified Vendor Intake | FR11 |
| FR-9 Vendor Receipt | FR12 |
| FR-10 Review History | FR13 |
| FR-11 Finding Normalization | FR14 |
| FR-12 Expert Classification | FR15 |
| FR-13 Remediation Guidance | FR16 |
| FR-14 Validation Paths and Scripts | FR17 |
| FR-15 False Positive and Accepted Risk Records | FR18 |
| FR-16 Remediation Verification Pass | FR22 |
| FR-17 Security Review Attestation | FR19 |
| FR-18 Supporting-Evidence Control Mapping | FR20 |
| FR-19 Signed Static Bundle and Static Portal | FR21 |
| FR-20 Pilot Metrics | FR23 |

When the internal PRD changes, update this crosswalk in the same pass so public and internal numbering do not diverge silently.
