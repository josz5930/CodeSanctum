# CodeAttest Partner-Facing Disclosures — DRAFT

Status: **DRAFT — not in force.** This language is a drafting starting point only.
It does not take effect until legal, privacy, and audit approval is recorded
under the production-readiness plan (Section 2 §8, "Approvals"). Until then, no
statement here is a binding commitment to any partner or customer.

Audience: pilot partners, customer security and compliance teams, and the CodeAttest
operator who will present these terms.

Derived from: `protocol/policies/claim-safety.v0.json` and
`docs/codeattest-assurance-boundary.md`. Where this draft and the assurance
boundary disagree, the assurance boundary governs and this draft must be
corrected.

Last updated: 2026-08-30.

---

## 1. Disclosure statement

CodeAttest prepares a structured secure-code review evidence package for a
selected application and commit. The evidence package is intended to support
security review, audit-readiness preparation, customer security review, and
technical diligence conversations.

What a partner receives is a claim-safe evidence package — a record of what was
selected, what evidence the customer approved to leave their environment, what
CodeAttest received, what scanner inputs ran, what an expert reviewer classified
on the submitted evidence basis, and what limitations apply.

CodeAttest does not issue a certification. In particular, the evidence package:

- does not state that the selected application is free of vulnerabilities;
- does not state that all code paths, runtime behavior, dependencies,
  infrastructure, or deployed configuration were reviewed;
- is not a SOC 2 opinion, a CPA assurance report, an ISO/IEC 27001
  certification, a regulatory certification, or a control attestation;
- does not oblige any auditor, regulator, customer reviewer, or investor to
  accept it; and
- does not replace the customer's auditor, assessor, compliance program, secure
  development lifecycle, vulnerability management program, or risk owner.

A cryptographic signature on an artifact shows which deployment key produced that
artifact. It says nothing about the completeness or quality of any review, and it
is not a statement that any finding was eliminated.

## 2. Data retention

This section states the intended retention posture. The concrete retention
period and the environment controls behind it are set by the operator and are
subject to the approvals in Section 2 §8 before they bind a partner.

- **Default environment.** The default environment profile is `synthetic_demo`.
  In that profile the system processes only synthetic, non-customer content, and
  no real customer source-derived evidence is accepted, stored, or transmitted.
- **Real evidence gate.** Real customer snippets or source-derived evidence are
  processed only after the documented evidence gate is raised to the
  partner-pilot real-snippet state, with the access, logging, encryption,
  retention, and deletion controls in place.
- **Retention period.** Retained review artifacts are held only for the period
  needed to prepare and support the evidence package for the engagement, after
  which they are purged under policy. The exact period is filled in by the
  operator before approval; it must be a specific duration, not "indefinite."
- **Minimization.** Evidence that was excluded, deleted under policy, or never
  collected is recorded as such in the evidence package, so a partner can see
  what was retained versus what was not.

## 3. Deletion-request path

A customer may request deletion of retained review artifacts for their
engagement.

- **How to request.** Send a deletion request to the operator's published
  deletion contact (placeholder for the approved address:
  `deletion@example.com`). The request should identify the review scope or
  engagement so the correct artifacts are located.
- **What happens.** The operator confirms the request, purges the retained
  artifacts for that scope under the deletion controls, and records deletion
  evidence. The append-only review history is not rewritten; instead, deletion
  is recorded as a new, typed event, so the fact and time of deletion remain
  auditable while the underlying content is removed.
- **What cannot be undone.** Once artifacts are purged, the evidence package can
  no longer project their content. References to deleted artifacts remain in the
  history as deletion records.
- **Turnaround.** The operator commits to a specific acknowledgement and
  completion window before approval; this draft does not assert one on the
  operator's behalf.

## 4. Incident contact and notification

- **Reporting an incident.** Suspected exposure of customer evidence, key
  material, or access should be reported to the operator's published security
  contact (placeholder for the approved address: `security@example.com`).
- **Notification intent.** If the operator determines that a partner's evidence
  or access was affected, the operator intends to notify the affected partner
  with the information known at the time and to update as the situation is
  understood. The specific notification timeline and content are set with legal
  and privacy review under Section 2 §8.
- **Scope honesty.** A notification describes what is known and what is not yet
  known. It does not assert that an issue is fully resolved before that has been
  established.

## 5. Per-bundle customer approval and consent flow

Each evidence bundle is prepared under explicit customer control over what
leaves the customer environment.

1. **Scope selection.** The customer selects the application and commit for
   review. Nothing outside the selected scope is in view.
2. **Disclosure control.** Before anything leaves the customer environment, the
   customer approves which evidence is included. Evidence the customer does not
   approve is not transmitted.
3. **Per-bundle confirmation.** For each bundle, the customer reviews a
   confirmation that lists the selected application and commit, the disclosure
   summary, the included artifact references, and the artifacts marked for
   deletion, and then confirms before the bundle is finalized. This confirmation
   is a customer action; the operator does not confirm on the customer's behalf.
4. **Record of consent.** The confirmation is recorded so that the evidence
   package reflects what the customer approved for that specific bundle.
5. **Withdrawal.** A customer may decline to proceed with a bundle before
   finalization, and may later use the deletion-request path in section 3 for
   artifacts already retained.

## 6. Claim-safety note

This draft is written to be claim-safe under
`protocol/policies/claim-safety.v0.json`: it does not assert a SOC 2 opinion or
certification, an ISO/IEC 27001 certification, a security guarantee, or that the
evidence package replaces an auditor or forces any third party to accept it.
Reviewers approving this language under Section 2 §8 should re-check it against
that policy and against `docs/codeattest-assurance-boundary.md`, and should keep
the DRAFT marking until approval is recorded.
