# Google Cloud Demo Profile

> **Superseded.** Sub-project A, the runtime spine (see [`services/host/README.md`](../../services/host/README.md)), chose a single self-hosted VPS with two fully separate deployments (`demo`, `pilot`) instead of Google Cloud. This document's evidence-handling constraints still apply to the self-hosted demo deployment; its Google Cloud billing/guardrail mechanism does not. The staged budget-guardrail *behavior* below carries over and is implemented by sub-project F.

Home for the future budget-guarded Google Cloud demo profile.

## Current State

No deployable Google Cloud resources exist yet — this directory is documentation only, describing the guardrails a future demo deployment must satisfy before it is built.

## Budget Guardrail

The demo target is a **US$20/month engineered guardrail**, not a provider billing guarantee. The future implementation is expected to provide:

| Threshold | Behavior |
| --- | --- |
| 50%, 75%, 90% of budget | Warnings, then slowdown |
| 95% of budget | Disablement of intake |
| 100% of budget | Shutdown of non-essential demo resources |

Budget controls and evidence-handling controls are **separate gates** — satisfying one does not satisfy the other.

## Evidence-Handling Constraints

The demo profile must use **synthetic or public non-customer fixture source-derived content only**. It must not:

- use Cloud SQL;
- accept real customer Raw Snippets, targeted files, scanner outputs, or any other real customer source-derived evidence,

until the protocol `environment-evidence-gate` (see [`protocol/schemas/README.md`](../../protocol/schemas/README.md)) is raised to `partner_pilot_real_snippet_ready` and all access-control, access-logging, encryption, retention-default, deletion-control, demo-budget, and signing/release-trust readiness fields are true.

## Rules for This Directory

- Do not add deployable Google Cloud resources, service accounts, secrets, Terraform, billing automation, storage readiness, deletion evidence, or intake-enabling configuration unless a later cloud/demo infrastructure story explicitly scopes them **and** raises the required budget and evidence-handling gates.
