# Worker Service

Home for future background processing: normalization, attestation assembly, static bundle generation support, retention, and deletion jobs.

Worker behavior depends on protocol contracts and append-only review events. It must not overwrite audit-significant state in place.

Story 3.1 adds pure Candidate Finding normalization. `normalizeCandidateFindings` consumes already-received protocol artifacts — a valid `ScannerFindingSet`, `BundleManifest`, `OutboundManifest`, `VendorReceipt`, and explicit artifact availability lookup — and emits a protocol-backed `ReviewFindingDraftSet`. It groups scanner Candidate Findings into reviewer-ready drafts while preserving scanner source, candidate ids, rule ids, severity, confidence, affected area, Coverage Mode, evidence basis, threshold gaps, and source-reference availability.

Normalization is deliberately input-only. It does not execute scanners, read repository files, perform network calls, access databases, mutate the review-event log, mint receipts, classify findings, create remediation guidance, generate validation paths, or write Attestation copy. A no-findings normalization may only state: "No findings were produced by the configured inputs," with the explicit limitation that this does not prove absence of vulnerabilities.
