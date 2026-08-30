# CodeAttest Public Documentation

This folder contains public-facing architecture, planning, and support documents for customer operators, technical evaluators, design partners, and investors evaluating CodeAttest.

CodeAttest is open source under the [GNU General Public License v3.0](../LICENSE) (GPLv3).

Implementation structure and local development entry points are documented from the repository root [README](../README.md) and the [Developer Guide](./developer-guide.md).

## Start Here

- [Documentation Index](./index.md): audience-based entry point for the full docs set.

## Architecture And Operations

- [Architecture Overview](./codeattest-architecture-overview.md): plain-language explanation of the product structure, actors, and evidence flow.
- [Technical Architecture](./codeattest-technical-architecture.md): repository and component map for engineers and technical diligence teams.
- [Support Guide](./codeattest-support-guide.md): triage model, ownership boundaries, and claim-safe response guidance for support and operations teams.
- [Developer Guide](./developer-guide.md): build/test commands, workspace layout, and the architecture rules contributors must hold.
- [Implementation Status](./implementation-status.md): detailed implemented-vs-deferred inventory.
- [Naming Cleanup](./codeattest-naming-cleanup.md): proposal for aligning the CodeAttest / CodeSanctum / `onevps` names.

## Product And Assurance

- [Functional Requirements](./codeattest-functional-requirements.md): what CodeAttest is expected to do in the partner-pilot scope, written for security, engineering, compliance, and investor readers.
- [Assurance Boundary](./codeattest-assurance-boundary.md): short claim-safe explanation of what CodeAttest is designed to show and what it does not assert.
- [Control Alignment Matrix](./codeattest-control-alignment.md): preliminary mapping from CodeAttest capabilities to SOC 2 Trust Services Criteria, ISO/IEC 27001:2022, and Singapore Digital Service Standards (DSS).

## Readiness And Partner Terms

- [Production-Readiness Guide](./codeattest-production-readiness.md): the infrastructure, live evidence, approvals, and repository work still required before the pilot can accept real customer source-derived evidence.
- [Partner-Facing Disclosures (DRAFT)](./codeattest-partner-disclosures-DRAFT.md): draft retention, deletion, incident, and consent language. Marked DRAFT and not in force until legal, privacy, and audit approval is recorded.

## Status

These documents describe the repository and partner-pilot target as of 2026-08-30. They are suitable for architecture discussion, technical diligence, and planning, but they are not a legal opinion, SOC 2 report, ISO/IEC 27001 certification statement, DSS compliance attestation, or guarantee of auditor, regulator, or customer acceptance.

Final public claims should be reviewed by legal, compliance, and audit advisors before customer launch.
