# CodeAttest Assurance Boundary

Status: Public-facing draft  
Audience: customer security teams, compliance teams, audit-readiness teams, investors  
Last updated: 2026-08-30

## 1. Short Version

CodeAttest produces structured secure-code review evidence for a selected application and commit without requiring full repository upload by default.

The evidence package can support security review, audit-readiness, customer security review, and technical diligence conversations. It does not replace the customer's auditor, assessor, compliance program, secure development lifecycle, vulnerability management program, or risk owner.

## 2. What CodeAttest Is Designed To Show

CodeAttest is designed to show:

- Which application and commit were selected for review.
- What evidence the customer approved to leave the customer environment.
- What CodeAttest received.
- Which scanner inputs ran locally and what Candidate Findings they produced.
- What an expert reviewer classified, and on what submitted evidence basis.
- Where evidence was sufficient, insufficient, or required customer-side validation.
- What remediation guidance and validation paths were provided.
- What remediation verification was performed for selected findings.
- Which source-derived artifacts were retained, deleted under policy, or never collected.
- What limitations apply to the review and evidence package.

## 3. What CodeAttest Does Not Claim

CodeAttest does not claim:

- That a selected application has no vulnerabilities.
- That all code paths, runtime behavior, dependencies, infrastructure, or deployed configurations were reviewed.
- That metadata-only or scanner-only evidence is enough to confirm every vulnerability.
- That CodeAttest issues a SOC 2 opinion, CPA assurance report, ISO/IEC 27001 certification, regulatory certification, DSS certification, or control attestation.
- That any auditor, regulator, customer reviewer, investor, or third party must accept the evidence package.
- That redaction or secret detection proves no sensitive content remains in approved snippets.
- That a remediation verification pass is a full new secure-code review.

## 4. Evidence Boundaries

### Customer Environment Boundary

The customer operates the Local Runner and controls whether evidence leaves the customer environment. The Outbound Manifest must show included and excluded evidence categories before any send action.

### Disclosure Boundary

The Disclosure Policy records whether the review uses Metadata-only, Finding-context snippets, or Extended approved snippets or targeted files. Each mode has different confidence and disclosure tradeoffs.

### Receipt Boundary

CodeAttest issues a Vendor Receipt only after verifying the submitted Evidence Bundle. Rejected or quarantined submissions do not receive a Vendor Receipt.

### Expert Judgment Boundary

CodeAttest reviewer classifications apply to the submitted evidence and recorded validation criteria. Findings can be confirmed, likely, inconclusive, or require customer-side validation.

### Attestation Boundary

The CodeAttest Security Review Attestation is a claim-safe evidence summary. It should state scope, methods, evidence received, classifications, validation paths, remediation status, limitations, receipt chain, and deletion evidence where applicable.

## 5. Recommended Public Wording

Use:

> CodeAttest provides structured supporting evidence for a scoped secure-code review, including disclosure controls, signed receipt records, expert classification, validation paths, and review limitations.

Avoid:

> CodeAttest certifies the code, guarantees compliance, proves SOC 2 readiness, or confirms the application is secure.

## 6. Review Requirements Before Launch Claims

Before customer launch claims, CodeAttest should review final wording with legal, compliance, and audit advisors, especially around:

- Use of the word "attestation."
- Use of the word "independent."
- Use of the word "confirmed."
- Any SOC 2, ISO/IEC 27001, DSS, regulatory, or customer-security-review mapping.
- Any statement about deletion, retention, redaction, cryptographic signature profile, or evidence-consumer acceptance.
