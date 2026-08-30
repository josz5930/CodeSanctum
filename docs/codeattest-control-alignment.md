# CodeAttest Control Alignment Matrix

Status: Preliminary public mapping  
Audience: customer security teams, audit-readiness teams, technical diligence teams, investors  
Last updated: 2026-08-30

## 1. Scope and Caveat

This document maps CodeAttest partner-pilot capabilities to selected SOC 2 Trust Services Criteria themes, ISO/IEC 27001:2022 clauses and Annex A controls, and Singapore Digital Service Standards (DSS) controls.

The mapping is intentionally conservative:

- CodeAttest can provide supporting evidence for a customer's review context.
- CodeAttest does not certify, satisfy, or guarantee acceptance of any framework control.
- Final mappings should be reviewed by the customer's auditor, assessor, legal counsel, and compliance owner.
- ISO/IEC 27001 and SOC 2 control interpretation depends on the customer's system boundary, Statement of Applicability, service commitments, and audit period.
- DSS is a public digital-service quality benchmark. CodeAttest is not claiming to be a Singapore government digital service; DSS is used here as a useful customer-facing service design and trust lens.

## 2. External References

- SOC 2 / Trust Services Criteria: AICPA Trust Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy, https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022
- ISO/IEC 27001:2022: Information security management systems requirements and Annex A control set, https://www.iso.org/standard/27001
- ISO/IEC 27002:2022: implementation guidance for information security controls, https://www.iso.org/standard/75652.html
- Singapore Digital Service Standards control catalog: https://info.standards.tech.gov.sg/control-catalog/dss/

## 3. Alignment Legend

| Term | Meaning |
|---|---|
| Direct support | CodeAttest is designed to generate evidence that can directly support assessment of the mapped theme. |
| Supporting context | CodeAttest contributes useful context but does not itself prove the mapped control. |
| Design target | Capability is specified for the partner-pilot product but should be validated during implementation. |
| Not primary | The framework topic is outside CodeAttest's main purpose or not in v1 scope. |

## 4. Capability-to-Control Matrix

| CodeAttest capability | Evidence generated | SOC 2 alignment | ISO/IEC 27001:2022 alignment | DSS alignment | Alignment posture |
|---|---|---|---|---|---|
| Customer-selected application and commit | Review Scope, selected commit, repository identity hash, runner version | CC2 communication, CC3 risk assessment, CC5 control activities | Clauses 4.3, 6.1, 8.1; A.5.9 inventory of information and assets; A.5.12 classification of information | TX-2 prerequisite information; TX-4 progress and context; WU-3 definitions and clarity | Direct support |
| Local runner execution in customer environment | Runner logs, scanner metadata, local-only preparation record | CC6 logical access, CC7 system operations, CC9 risk mitigation | A.5.14 information transfer; A.5.15 access control; A.8.8 management of technical vulnerabilities; A.8.28 secure coding | PR-3 service availability expectations; TX-3 step-by-step task flow | Supporting context |
| Disclosure Policy | Policy settings, coverage mode, snippet caps, redaction, retention preference | CC2 communication, CC3 risk assessment, CC5 control activities, C1 confidentiality | A.5.12 classification; A.5.14 information transfer; A.5.34 privacy and protection of PII where applicable; A.8.11 data masking; A.8.12 data leakage prevention | TX-2 prerequisite information; TX-12 clear transaction outcome; WU-10 error identification; WU-12 error prevention | Direct support |
| Outbound Manifest preview | Manifest with included/excluded categories, source-derived status, limits, warnings | CC2 communication, CC5 control activities, C1 confidentiality, PI1 processing integrity context | A.5.12 classification; A.5.14 information transfer; A.5.33 protection of records; A.8.12 data leakage prevention | BD-4 clear content; TX-3 break down complex transactions; TX-9 confirmation before submission; WU-11 error suggestion | Direct support |
| Explicit approval before send | Approval timestamp, actor identifier where available, declined state | CC5 control activities, CC6 logical access, CC8 change management | A.5.15 access control; A.5.18 access rights; A.5.33 protection of records; A.8.32 change management | TX-9 confirm before submission; TX-12 outcome clarity; WO-18 pointer target size for controls | Direct support |
| Deterministic Evidence Bundle identity and runner signature | Evidence Bundle identity, manifest identity, artifact digests, signature envelope | CC5 control activities, CC7 system operations, CC8 change management, PI1 processing integrity | A.5.33 protection of records; A.8.24 use of cryptography; A.8.25 secure development life cycle; A.8.29 security testing in development and acceptance | TL-style trust evidence; TX-12 outcome clarity; WR-2 status messages | Direct support |
| Verified vendor intake | Intake verification record, rejected/quarantined/received states | CC6 logical access, CC7 system operations, CC9 risk mitigation | A.5.15 access control; A.5.23 information security for cloud services; A.8.15 logging; A.8.16 monitoring | TX-10 failed transaction details; TX-14 status updates; WR-2 status messages | Direct support |
| Signed Vendor Receipt | Receipt id, bundle id, timestamp, receiving environment, signing key/version | CC2 communication, CC7 system operations, PI1 processing integrity, C1 confidentiality | A.5.33 protection of records; A.8.15 logging; A.8.24 cryptography | TX-12 transaction outcome; TX-15 transaction tracking; TL-style legitimacy and provenance | Direct support |
| Append-oriented review event history | Review events, actors, timestamps, supersedes links, artifact refs | CC4 monitoring, CC7 system operations, CC8 change management, CC9 risk mitigation | A.5.24 incident management planning; A.5.25 event assessment; A.5.28 collection of evidence; A.5.33 protection of records; A.8.15 logging | TX-14 status updates; TX-15 tracking; WR-2 status messages | Direct support |
| Evidence storage, access, retention, and deletion controls | Access events, retention classes, deletion evidence, storage control records | CC6 logical access, CC7 operations, C1 confidentiality, P-series if PII is in scope | A.5.15 access control; A.5.16 identity management; A.5.18 access rights; A.5.23 cloud services; A.8.10 information deletion; A.8.15 logging | TL-style trust handling; TX-12 outcome clarity; WU-12 error prevention | Direct support, design target |
| Candidate Finding normalization | Candidate Findings, grouping, scanner source references, limitation notes | CC7 system operations, CC9 risk mitigation | A.8.8 management of technical vulnerabilities; A.8.28 secure coding; A.8.29 security testing | BD-4 clear content; WR-1 name role value; WR-2 status messages | Supporting context |
| Expert classification | Finding classification, criteria, evidence basis, limitation, reviewer rationale | CC2 communication, CC3 risk assessment, CC4 monitoring, CC7 operations | A.5.28 collection of evidence; A.8.8 vulnerability management; A.8.29 security testing | BD-4 clear content; WU-3 definitions; WR-2 status messages | Direct support |
| Remediation guidance and validation paths | Remediation steps, validation path, customer-side validation records | CC3 risk assessment, CC4 monitoring, CC7 operations, CC9 risk mitigation | A.8.8 vulnerability management; A.8.25 secure development life cycle; A.8.28 secure coding; A.8.29 security testing | TX-3 guided steps; WU-11 error suggestion; WU-12 error prevention | Supporting context |
| False-positive and accepted-risk records | Reviewer rationale, customer sign-off or rationale, retained evidence record | CC3 risk assessment, CC4 monitoring, CC9 risk mitigation | A.5.28 collection of evidence; A.5.33 protection of records; Clause 6.1 risk treatment | TX-12 outcome clarity; TX-15 tracking; BD-4 clear content | Supporting context |
| Remediation verification pass | Follow-up commit, validation evidence, before/after status, addendum | CC4 monitoring, CC7 operations, CC9 risk mitigation | A.8.8 vulnerability management; A.8.29 security testing; A.8.32 change management | TX-14 updates; TX-15 tracking; WR-2 status messages | Direct support for selected findings |
| Security Review Attestation | Scope, method, evidence received, classifications, validation, limitations, receipt chain | CC2 communication, CC3 risk assessment, CC4 monitoring, CC7 operations, C1 confidentiality where relevant | A.5.28 collection of evidence; A.5.31 legal/statutory/regulatory requirements; A.5.33 protection of records; A.8.34 protection during audit testing | TL-style trust content; BD-4 clear content; TX-12 outcome clarity | Direct support |
| Signed Static Bundle / Generated Static Portal | Static bundle manifest, digests, portal pages, verification metadata | CC2 communication, CC5 controls, CC7 operations, PI1 processing integrity | A.5.33 protection of records; A.8.24 cryptography; A.8.34 protection during audit testing | BD-6 consistent UI; TX-15 tracking; WP/WO/WU/WR accessibility controls | Direct support |
| Accessibility and claim-safe UX | Warnings, visible states, keyboard support, readable static portal | CC2 communication | A.5.34 privacy where relevant; A.8.26 application security requirements; A.8.29 security testing | WCAG-aligned DSS groups WP, WO, WU, WR; BD-4 clear content | Supporting context, design target |
| Pilot metrics and learning loop | Classification yield, turnaround, review hours, disclosure mode, usefulness feedback | CC4 monitoring, CC9 risk mitigation | Clause 9.1 monitoring, measurement, analysis and evaluation; Clause 10 improvement | UU-1 understand users; UU-2 usability testing and research | Supporting context |

## 5. SOC 2 Mapping Notes

CodeAttest most strongly supports SOC 2 evidence conversations around Security, Confidentiality, Processing Integrity context, and selected Availability commitments where relevant to the hosted service.

| SOC 2 area | CodeAttest support |
|---|---|
| Security | Access control, review-scoped submission, event history, intake verification, evidence handling, and deletion evidence can support security-control evidence. |
| Confidentiality | Disclosure Policy, manifest review, source-derived classification, retention choices, and deletion evidence can support confidentiality commitments around customer security data. |
| Processing Integrity | Deterministic evidence identities, signature envelopes, Vendor Receipts, and approved-versus-received comparison can support integrity of evidence processing. |
| Availability | Demo and pilot infrastructure guardrails, submission states, and recovery/rerun behavior may support availability commitments only if those commitments are defined for the service. |
| Privacy | Not a primary v1 claim unless personal data is included in customer evidence. If PII appears in evidence, privacy requirements must be scoped explicitly. |

## 6. ISO/IEC 27001:2022 Mapping Notes

CodeAttest is most relevant to an ISO/IEC 27001 Statement of Applicability where the customer or CodeAttest needs evidence for secure development, vulnerability handling, evidence protection, access control, cryptographic integrity, logging, deletion, and supplier/cloud service handling.

Candidate ISO control areas include:

- Clauses 4.3, 6.1, 8.1, 9.1, and 10 for ISMS scope, risk treatment, operational planning, monitoring, and improvement.
- A.5 organizational controls such as information classification, information transfer, access control, cloud services, incident/evidence handling, protection of records, legal/regulatory requirements, and documented operating procedures.
- A.8 technological controls such as privileged access, information access restriction, vulnerability management, configuration management, information deletion, data masking, data leakage prevention, logging, monitoring, cryptography, secure development, application security requirements, secure architecture, secure coding, security testing, change management, test information, and audit-test protection.

This mapping does not replace the customer's Statement of Applicability.

## 7. DSS Mapping Notes

The DSS catalog is useful for CodeAttest public UX expectations even though CodeAttest is not a government digital service. The strongest DSS-style alignment areas are:

- Clear upfront task information and explicit submission confirmation for the Local Runner and manifest approval flow.
- Clear success, failure, rejected, quarantined, received, under review, verification pending, and finalized states.
- Customer-controlled transaction records through Vendor Receipt, review history, and static bundle manifests.
- Accessibility-oriented web and static portal behavior using WCAG-aligned groups for perceivable, operable, understandable, and robust interfaces.
- User research and pilot metrics to validate whether AppSec leads, reviewers, and evidence consumers understand the workflow.

DSS transaction/payment controls that assume consumer payment flows are not primary v1 scope because CodeAttest does not process customer payments inside the partner-pilot product surface.

## 8. Evidence Package Suggested for Customer Diligence

For future technical customers and investors, CodeAttest should be prepared to show:

1. Functional Requirements document.
2. Architecture overview and evidence protocol summary.
3. Control Alignment Matrix.
4. Sample Outbound Manifest using fixture content.
5. Sample Evidence Bundle manifest and digest/signature metadata using fixture content.
6. Sample Vendor Receipt using fixture content.
7. Sample Security Review Attestation using fixture content.
8. Sample Signed Static Bundle or static portal export using fixture content.
9. Security and retention design notes, including deletion evidence behavior.
10. Public assurance-boundary statement.

## 9. Open Items Before Formal Customer Use

- The signing profile is ML-DSA-65 in code; confirm the production key custody model (current custody is self-hosted software custody, not a hardware security module) with security review.
- Confirm storage region, residency, retention, and deletion-evidence expectations with design partners.
- Decide whether SOC 2, ISO/IEC 27001, and DSS mappings live inside the Attestation, as a companion appendix, or only as sales-engineering diligence material.
- Review the words "attestation," "independent," and "confirmed" with legal/compliance advisors before public launch claims.
- Validate all public sample artifacts use fixture or synthetic content only.
