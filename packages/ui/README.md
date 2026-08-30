# UI Package

Home for the CodeAttest shared UI foundation. Story 2.1 provides dependency-light, component-ready TypeScript render contracts for the first receipt and review-state surfaces. Later React/shadcn/Tailwind screens can render these contracts without redefining evidence vocabulary.

## Story 2.1 primitives

The public barrel `src/index.ts` exports:

- `ReceiptBanner` - renders a verified Vendor Receipt state only when receipt identity, received bundle identity, UTC receipt timestamp, and `verificationState: "received_with_receipt"` are present; invalid props return `null` so callers can filter safely.
- `RiskWarning` - renders blocking failed-submission, failed-verification, malformed-bundle, and evidence-handling warnings with affected identity and visible next paths.
- `StatusPill` - renders text-first lifecycle labels for receipt and review states.
- `EvidenceCard` - renders one bounded artifact at a time with identity, timestamp, actor, state, and reachable detail action.
- `TimelineEvent` - renders append-oriented receipt/review-history events with actor, timestamp, artifact reference, and customer-facing/internal-only visibility; `internal_only` events return `null` for `customer` audience so sensitive metadata is not surfaced.
- `AppShell` - renders actor context, selected application, selected commit, and review state without mixing customer and vendor controls.

The primitives return serializable view contracts rather than browser components. This is intentional for Story 2.1: the repository does not yet have React, Next.js, Tailwind, shadcn/ui, or browser accessibility tooling installed in the UI package. The contracts are synchronous, local, testable through TypeScript, and ready for later rendering adapters.

## State vocabulary

`receiptReviewStateValues` defines the initial Story 2.1 vocabulary:

- `not_submitted`
- `submitted`
- `received`
- `received_with_receipt`
- `rejected_no_receipt`
- `quarantined_no_receipt`
- `under_review`
- `review_complete`
- `verification_pending`
- `finalized`
- `deleted`
- `retained`
- `not_collected`
- `unknown`

Every normal workflow state has visible text and an accessible explanation. The `unknown` sentinel is reserved for runtime drift or untyped JSON callers; it is rendered as “Unknown state” and does not imply receipt, review completion, or verification.
Color roles are secondary metadata only; state meaning must never depend on color alone.

## Design tokens

`codeAttestDesignTokens` carries the CodeAttest UX token layer from `DESIGN.md`:

- document-forward surface and ink colors
- semantic verification, warning, risk, review, and neutral color roles
- product and mono font stacks
- spacing and radius scales
- focus ring contract
- 44px minimum target-size contract
- reduced-motion contract using `(prefers-reduced-motion: reduce)`

Verification green is only for receipt/signature/integrity success. Risk red is only for failed verification, malformed evidence, destructive data handling, and security/privacy blockers. Warning amber is for disclosure friction, retention choices, redaction limits, reduced confidence, and customer-side validation.

The primitives store **raw visible text** in their view fields after stripping Unicode controls that can hide or reorder text: NULL, C0/C1 controls, bidi overrides/isolates, zero-width characters, word joiner, line/paragraph separators, BOM, soft hyphen, Mongolian vowel separator, Hangul filler, and Braille blank. They do **not** HTML-entity encode strings. Non-string, non-numeric, non-bigint inputs coerce to empty string (they do not throw), so JSON-sourced payloads with unexpected shapes cannot crash the render. Rendering adapters must escape text at the render boundary: React text nodes already do this; any adapter using an HTML insertion API must escape explicitly and must not pass these fields to `dangerouslySetInnerHTML`.

## Safety and accessibility guarantees

Story 2.1 tests enforce that primitives:

- expose all required public exports through `src/index.ts`
- render visible labels for every receipt/review state
- do not render a receipt banner for no-receipt states
- keep rejected and quarantined states explicit about no Vendor Receipt
- include affected identities and next paths for risks
- model native accessible semantics such as status/alert/live-region contracts
- avoid positive `tabIndex` and hidden-hover-only actions
- expose at least 44px CSS target-size metadata for actions
- expose reduced-motion metadata and avoid nonessential animation hooks
- avoid `dangerouslySetInnerHTML`, raw evidence examples, secrets, and overclaiming copy
- omit internal-only note bodies from customer-facing timeline projections
- construct fixture contracts synchronously without network calls, timers, or hosted runtime access

## Scope boundaries

This package does not implement intake verification, Vendor Receipt signing, event-log persistence, storage/access/deletion controls, reviewer classification, attestation generation, static portal navigation, or network submission. Protocol schemas and generated protocol bindings remain the authority for protocol semantics.

Do not use copy that implies certification, regulator approval, auditor acceptance, independent assurance, absence of vulnerabilities, or successful receipt when a Vendor Receipt is not present.

Story 2.6 adds `SubmissionFailureNotice` and `buildSubmissionAttemptTimeline` in `src/submission-failure.ts`. A failed submission renders through the existing `RiskWarning` primitive as a `role: "alert"` blocking warning; `RiskWarningProps.affectedIdentity` now accepts an array so one failed submission can name every identity it knows, and the view exposes `affectedIdentities` alongside the existing singular `affectedIdentity` field. The protocol `next_path` vocabulary is mapped onto `RiskWarningNextPathType` here (`quarantine_support` → `quarantine`, `contact_support` → `support`) rather than by widening either union, so the existing audience gating — which drops a `quarantine` path entirely for `audience: "customer"` — keeps working unchanged. The timeline reads the existing `review-event-log` submission events, not a bespoke history type, and invalid timestamps surface as explicit error entries. A `received_with_receipt` outcome renders nothing at all.

Story 3.2 adds `ClassificationBadge` and `ReviewerClassificationWorkbench` in `src/classification-workbench.ts`. These are still serializable view contracts rather than React components. The workbench view keeps evidence references, scanner context, classification criteria, reviewer notes, remediation guidance placeholder, validation path, threshold gaps, limitations, current classification state, keyboard action metadata, and snippet disclosure metadata visible together. It exposes both `desktop_two_column` and `stacked_narrow` layout metadata with the same action set and panel coverage. Unknown classification or evidence-basis values surface as explicit unknown states rather than being coerced or dropped, and null/missing arrays render empty states instead of crashing. Text-entry areas such as reviewer notes, remediation guidance, validation path, and snippet text are explicitly marked as shortcut-suppressed zones; multiline reviewer text preserves newlines, tabs, and carriage returns while stripping invisible controls. Snippet blocks are labeled `Source-code disclosure`, preserve valid line references and in-range redaction markers, filter impossible redaction lines, and expose copy/download actions as reachable controls whose enabled state is permission-gated.

Story 3.3 adds structured remediation guidance and customer-facing finding record contracts. `ReviewerClassificationWorkbench` can now render a protocol `finding-remediation-guidance` record in the remediation panel, while preserving shortcut suppression for remediation text fields. `RemediationGuidanceSummary` exposes text-first guidance status, evidence references, limitations, next steps, and validation handoff copy without using verification green for remediation work. `CustomerFindingRecordView` renders a `customer-facing-finding-record` as separate labeled sections for expert classification, evidence basis/limitations, reviewer remediation guidance, customer owner/status metadata, verification state, and future risk-acceptance/false-positive visibility. Customer notes obey the protocol export posture and are omitted for evidence-consumer views unless explicitly included. These remain serializable view contracts, not React components, and do not create accepted-risk, false-positive, verification, or Attestation records.

Story 3.4 extends those serializable contracts for formal validation paths and reviewer-authored scripts. `ReviewerClassificationWorkbench` accepts structured validation-path and reviewer-script records, keeps their fields in the existing validation-path panel, labels remote/customer-script/manual branches separately, preserves script execution/safety text as shortcut-suppressed validation-path content, and keeps additional-script candidates visibly marked as pricing TBD. `CustomerFindingRecordView` can render separate Validation paths and Reviewer-authored scripts sections while leaving verification state separate and not using verification green for path or script authoring. These contracts continue to avoid React/runtime dependencies and rely on renderer adapters to escape text at the final UI boundary.


Story 3.5 extends `CustomerFindingRecordView` with record-backed false-positive and accepted-risk outcome sections. Sections render visible labels, record references, evidence basis, limitations, responsible actor category, and reviewer rationale or customer rationale/sign-off when the protocol record exists. No placeholder outcome rows are rendered when records are absent, and accepted-risk/false-positive chips use warning/neutral posture rather than verification green. Accepted risk copy is bounded to customer-approved residual-risk language and does not imply remediation, verification, auditor acceptance, control satisfaction, certification, regulator approval, independent assurance, or absence of vulnerabilities.

Story 4.1 adds `VerificationPassScopeView` as a dependency-free serializable contract for the included verification-pass scope artifact. It renders selected finding refs, classification, remediation status, requested verification type, eligibility state/reason, pass deadline, included script slots 1..3, and additional-script candidates with pricing TBD posture. A non-dismissible disclosure states that the pass is limited to selected findings, submitted follow-up evidence, and recorded validation criteria; it is not a fresh full review or verification outcome. Blocked and additional-agreement states render next steps rather than failure/success labels, and malformed or claim-unsafe scope input returns an unavailable view.

## Epic 5 serializable contracts

Stories 5.1–5.6 add dependency-free view contracts without introducing a browser framework or network boundary:

- `AttestationBuilderView` renders independently readable scope/evidence/limitation/reference sections, lifecycle distinctions, receipt chain, generation authority, and one-step identity-copy metadata.
- `SupportingEvidenceMappingView` renders approved/versioned SOC 2 supporting-evidence, generic technology-risk, and customer-security-review profiles only. It keeps scope, method, receipt, findings, validation, limitations, decision authority, and the acceptance disclaimer together.
- `StaticBundleGenerationView` shows bundle/manifest identities, included-file digests, minimization dispositions, offline verification metadata, the software-custody signing limitation, and actionable blocking risk warnings.
- `AttestationFinalizationView` requires a customer actor and complete visible sharing context. Inline confirmation names the affected identity, customer control after export is explicit, and generated/finalized/exported events remain distinct.
- `PilotLearningView` is internal-only and content-free. Customer/evidence-consumer calls return `null`; `excludeInternalLearningFromCustomerArtifact` rejects pilot feedback, unit economics, payload-like fields, cyclic values, and non-serializable data at customer projection boundaries.

All contracts remain plain serializable objects, use text-first state and warning copy, expose 44px/focus metadata, avoid hidden-hover actions, and fail closed without throwing. Attestation, supporting-evidence mapping, static bundle generation, and pilot-learning views consume generated protocol record types directly. `AttestationFinalizationView` is deliberately a pre-action confirmation model: it keeps receipt, signature, deletion, portal, limitation, recipient, and export-consequence context visible before customer action; the post-action `attestation-package-finalization` protocol record remains the system of record.

Stories 4.2–4.4 add `VerificationEvidenceIntakeView`, `VerificationDecisionView`, and `VerificationAddendumView`. These remain serializable, dependency-light view contracts backed by generated protocol record types. Evidence intake displays metadata and lifecycle labels only; reviewer decisions display the original classification/evidence/criteria basis separately from after-state results; addenda preserve selected commit, retained/deleted evidence, history links, limitations, and finalization. Every view is text-first, exposes focus/minimum-target metadata, avoids hover-only actions, hides internal-only records from customer views, and returns an unavailable state for malformed, payload-bearing, claim-unsafe, or finalization-inconsistent input.
