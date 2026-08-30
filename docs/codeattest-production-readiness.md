# CodeAttest Production-Readiness Guide

This document lists what remains before CodeAttest can run as a live,
partner-facing service that accepts real customer source-derived evidence in an
enterprise setting. It is written for the repository owner and any operator
provisioning the pilot.

> **Status (2026-08-30).** Section 1's agent-executable code fixes (C1–C9) have
> landed. The items are retained below as a record of the runtime and
> completeness gaps that were closed. The open path to accepting real customer
> evidence is now Section 2: live provisioning, live control evidence, the
> synthetic-only soak, and the named human approvals — none of which a code
> change can satisfy.

It is split by **who can do the work**, not by topic:

- **Section 1 — Agent-executable work.** Source, CI, and documentation changes a
  coding agent can complete and merge now. A few carry a decision only a human
  can make (product direction, which external sink, which disclosure language);
  those are flagged **⟳ human-in-the-loop** — the human decides, the agent
  implements. Nothing in Section 1 raises a gate or approves a control; it closes
  the runtime and completeness gaps Section 2's live drills would otherwise hit.
- **Section 2 — Human-only processes.** Provisioning, live-evidence collection,
  and named approvals that **no** code change, configuration, or passing unit
  test can satisfy — administrator-controlled hosts, live observation with an
  independent reviewer, and named human sign-off.

---

## 0. How to read this list

Each item carries one or more tags:

- **[CODE]** — changes shipped source. Agent work. All of Section 1's core list.
- **[REPO]** — can be done in the repository (CI, tooling, docs) without changing
  shipped source. Agent work.
- **[EVIDENCE]** — requires live observation against a provisioned pilot, with an
  independent reviewer, per the partner-pilot gate-acceptance process described in
  Section 2 §4–§5. Human work.
- **[APPROVAL]** — requires a named human decision (security, operations,
  cryptography, privacy, or legal), separate from the person who produced it.

**Section mapping:** Section 1 holds every **[CODE]** and **[REPO]** item.
Section 2 holds every **[INFRA]**, **[EVIDENCE]**, and **[APPROVAL]** item. Where
an item has both a repository half and a human half, the repository half lives in
Section 1 and the human half in Section 2, each pointing at the other.

---

# Section 1 — Agent-executable work ([CODE] / [REPO])

These are source and repository changes surfaced by a production-readiness code
review on 2026-08-29. The review found the protocol, canonicalization, ML-DSA-65
signing, append-only event log, and authentication core to be sound and
defensively coded; the open gaps cluster in the `services/host` runtime seams and
the Postgres persistence adapter. None of these items raises a gate — they make
the service survive the conditions Section 2's live drills create.

**Suggested ordering.** C1, C4, and C5 are self-contained, low-risk, and safe to
land immediately. C2 pairs with Section 2 §7 (readiness/liveness). C3 is a
prerequisite for demonstrating the customer web surface during the §5 soak.

## C1. Attach a Postgres pool error listener and connection controls — [CODE] — high

File: `packages/evidence-store/src/postgres/pool.ts`.

`node-postgres` emits an `'error'` event on **idle** pooled clients when the
backend drops a connection (database restart, failover, transient network loss).
The pool is created with no listener, so the event is unhandled and Node
terminates the host process — precisely during the database instability the
service most needs to ride out. There is no `pool.on('error', …)` anywhere in the
repository.

- [X] Attach `pool.on('error', …)` that logs and does **not** rethrow.
      Implemented in `packages/evidence-store/src/postgres/pool.ts`; a spy test
      (`test/postgres-pool-controls.test.mjs`) confirms exactly one `'error'`
      listener is attached and that it logs via the configured sink without
      rethrowing.
- [X] Set explicit `max`, `idleTimeoutMillis`, and `connectionTimeoutMillis`, and
      either configure `ssl` or document that TLS is delegated to the
      `database_url` `sslmode`. Defaults (`max` 10, `idleTimeoutMillis` 30_000,
      `connectionTimeoutMillis` 10_000) are set on the pool config, `ssl` is an
      opt-in override, and the doc-comment records TLS delegation to
      `database_url`'s `sslmode`. The controls test drives the
      connection-timeout path against an unreachable backend.

## C2. Make `/readyz` reflect live database reachability — [CODE] — high

Files: `services/host/src/server.ts`, `services/host/src/main.ts`.

`/readyz` returns ready from a boot-time boolean that is only flipped to false on
`SIGTERM`. If Postgres becomes unreachable after boot, `/readyz` still returns 200
and any upstream keeps routing traffic into a broken host. This closes the
"`/readyz` post-boot database-liveness limitation" that Section 2 §7 otherwise
records as an open operational gap.

- [X] Back `isReady()` with a cheap liveness probe (`SELECT 1`) with a short
      timeout and a small cached TTL so readiness polling cannot hammer the DB.
      Implemented in `services/host/src/readiness.ts` (`createDatabaseReadiness`:
      TTL-cached, timeout-bounded, concurrent probes collapsed) and wired in
      `main.ts` as `isReady = () => ready && readiness.isLive()`; `server.ts`
      now awaits `isReady`.
- [X] **Acceptance:** with the DB stopped, external and loopback `/readyz` return
      503; on recovery they return 200. Verify inside the §5 readiness sampling.
      Behavior unit-verified end-to-end through `/readyz` in
      `test/readiness.test.mjs` (down → 503, recovery → 200, TTL caching, and
      timeout on a hung query). *External/loopback split and the §5 sampling
      remain the Section 2 live verification.*

## C3. Seed or wire a real source for the web review record store — [CODE] — high — ⟳ human-in-the-loop

Files: `services/host/src/main.ts` (~line 171),
`services/host/src/web/record-store.ts`, `services/host/src/routes/web.ts`.

`main.ts` injects `createMemoryReviewRecordStore()`, but nothing ever calls its
`.seed()` (no seed path exists in the repository). Every `/web/reviews/:scope`,
`/findings`, and `/attestation` route therefore reads `undefined`, and the
`@onevps/ui` projections fail-close to "unavailable". The customer-facing web
review surface renders empty in the shipped host binary, and the store is
in-memory, so it would not survive a restart even once seeded.

- [X] **⟳ Decide the record source** (product/architecture decision, not
      pre-empted here): (a) seed from the shipped synthetic protocol fixtures for
      `synthetic_demo`, or (b) introduce a persisted read model populated by the
      review lifecycle. The agent implements whichever is chosen. Owner decision:
      (a) — synthetic_demo is served from the shipped fixtures; a persisted read
      model (b) is deferred until a live review lifecycle exists.
- [X] Implement the chosen source and replace the unseeded in-memory store in
      `main.ts`. Implemented in `src/web/seed-record-store.ts`
      (`seedSyntheticDemoReviewRecords`), wired into `main.ts` behind the `demo`
      deployment identity. The static-bundle sub-view carries a real ML-DSA-65
      verification claim, so it is seeded only when the host's real verifier
      actually verifies the shipped signature; the shipped fixture directory is a
      retired test vector that a deployment does not trust, so that one panel
      fail-closes to "unavailable" rather than asserting an unperformed
      verification, while detail / findings / attestation render fully.
- [X] **Acceptance:** an authenticated customer with a scoped grant sees
      non-"unavailable" detail / findings / attestation for a seeded review, and
      the content survives a host restart. Verified by `test/web-routes.test.mjs`
      (a scoped customer gets a receipt-backed detail, one finding + verification
      scope, and an available attestation, all via the production seed path,
      which `buildTestServer` now exercises) and `test/seed-record-store.test.mjs`
      (re-seeding a fresh store reproduces identical content — a restart serves
      the same review — and an untrusted verifier omits only the static bundle).

## C4. Add process-level crash handlers and SIGINT handling — [CODE] — medium

File: `services/host/src/main.ts`.

Only `SIGTERM` is handled. On Node 24 an unhandled promise rejection outside
Fastify's request lifecycle terminates the process without draining in-flight
requests or closing the pool, and `SIGINT` (Ctrl-C / some supervisors) is not
handled at all.

- [X] Add `process.on('unhandledRejection', …)` and
      `process.on('uncaughtException', …)` that log and run the same bounded
      drain-then-exit path. Implemented via `installShutdownHandlers` in
      `main.ts` (single guarded drain-then-exit; both crash handlers exit
      non-zero).
- [X] Handle `SIGINT` identically to `SIGTERM`. Both drain cleanly and exit 0.
- [X] **Acceptance:** a forced unhandled rejection drains and exits non-zero
      rather than dying abruptly; SIGINT drains cleanly. Verified by
      `test/main.test.mjs`: SIGTERM/SIGINT run setNotReady→drain→endPool and exit
      0; unhandledRejection/uncaughtException run the same path and exit 1; a
      second trigger is a no-op.

## C5. Fail — do not strand — a retention-expiry job when a delete throws — [CODE] — medium

File: `packages/evidence-store/src/retention-expiry.ts`
(`processRetentionExpiryJob`, ~lines 75–88).

If `artifacts.delete()` throws mid-loop, the exception propagates and the claimed
job is left neither completed nor failed — a stuck or lost purge depending on the
queue's lease semantics. Deletion durability is a Section 2 §4 control, so the
worker must be robust before the deletion canary runs.

- [X] Wrap the per-artifact delete; on error route the job to `jobs.fail(...)`
      (for retry) instead of letting the loop throw. Implemented in
      `processRetentionExpiryJob`: the delete loop is wrapped, and a throw routes
      the claimed job to `jobs.fail()` and ends the drain pass (fail un-claims,
      so continuing would re-claim the same job).
- [X] **Acceptance:** injecting a delete failure in a drill leaves the job
      re-claimable and the worker continues; no job is stranded in `claimed`.
      Verified by `test/retention-expiry.test.mjs`: a throwing `artifacts.delete`
      yields `processed: 0`, reports the job in `failed`, does not throw, and the
      job is re-claimable on the next pass.

## C6. Lower-priority hardening — [CODE] — low

- [X] Add an IP/global HTTP rate limit (e.g. `@fastify/rate-limit`) in front of
      the auth and submission routes before any route is internet-facing; today
      only the per-identifier login throttle exists
      (`services/host/src/routes/auth.ts`). Acceptable while loopback-only;
      revisit when Caddy fronts a real route (Section 2 §1). Implemented as a
      dependency-free per-IP fixed-window cap (`services/host/src/rate-limit.ts`,
      wired in `main.ts` at 600 req/min/IP over every business route; `/healthz`
      and `/readyz` exempt), swappable for `@fastify/rate-limit` behind a real
      edge. Verified by `test/rate-limit.test.mjs`.
- [X] `packages/signing/src/envelope.ts` (~line 71) reports
      `directory_version = 1` when the key directory is untrusted. Verification
      still fails closed, but the reported version is cosmetic and misleading —
      report the actually parsed version or an explicit sentinel. Fixed: the
      outcome now reports the directory's real parsed `directory_version` even
      when untrusted, falling back to the schema-minimum sentinel `1` only when
      no valid version is parseable. Verified by `packages/signing/test/envelope.test.mjs`.

## C7. Wire the observability SLO checker to a configurable alert sink — [CODE] — medium — ⟳ human-in-the-loop

The observability SLO checker fires against a loopback timer today and has no real
destination. The **code** to emit to a configurable sink (webhook/exporter) and to
degrade safely when it is unreachable is agent work.

- [X] Add a configurable alert-sink target (URL/credentials via host config) and
      emit SLO breaches to it, failing safe if the sink is down. Implemented in
      `scripts/check-observability.mjs` (`resolveAlertSink` reads
      `--alert-webhook` / `--alert-token` / `--alert-source` or the matching
      `CODEATTEST_ALERT_*` env vars; `deliverSloAlert` POSTs the breach payload
      and never throws — a missing, misconfigured, rejecting, or unreachable sink
      logs and returns a structured non-delivery). `main()` calls it on breach in
      addition to the existing exit-code/notify-hook contract.
- [X] **Acceptance:** with a stub sink configured, a simulated SLO breach delivers
      exactly one alert; with the sink unreachable, the checker logs and does not
      crash. Verified by `test/observability-check.test.mjs`: a stub `fetch`
      records exactly one POST carrying the breach payload and bearer credential;
      a throwing `fetch` yields `delivered:false`/`reason:"sink_unreachable"` with
      a logged message and no throw; a non-2xx response and a missing/malformed
      sink are likewise logged non-deliveries.

## C8. Close F-9 off-box transparency-checkpoint publication — [CODE] — medium

Implement the code path that publishes the event-log transparency checkpoints to
an external anchor so the chain is externally verifiable. The anchor endpoint and
its credentials are provisioned by a human in Section 2 §1/§7; the publication and
verification code is agent work.

- [X] Implement checkpoint publication to a configurable off-box anchor and a
      verifier that confirms a published checkpoint round-trips. Implemented in
      `packages/evidence-store/src/transparency/publication.ts`: a
      `TransparencyAnchor` port (deployment supplies the HTTP/object-store
      adapter with the human-provisioned endpoint + credentials),
      `publishCheckpoint` (content-addressed `checkpoint_id`, rejects an anchor
      that returns no reference), and `verifyPublishedCheckpoint` (fetches the
      record back, checks it is self-consistent and equals what was published).
- [X] **Acceptance:** against a stub/local anchor, a checkpoint is published and
      re-verified end to end; missing anchor config fails closed, not silently.
      Verified by `test/transparency-publication.test.mjs`: an in-memory anchor
      round-trips a published checkpoint; an undefined anchor throws
      `TransparencyAnchorNotConfiguredError` for both publish and verify; a
      never-published, tampered, or mismatched record verifies false with a
      reason; and an anchor returning no reference is rejected rather than
      reported published.

## C9. Draft partner-facing disclosure, retention, deletion, incident, and consent docs — [REPO] — medium — ⟳ human-in-the-loop

Draft, from `protocol/policies/claim-safety.v0.json` and
`docs/codeattest-assurance-boundary.md`, the partner-specific disclosure,
retention period, deletion-request path, incident contact, and per-bundle customer
approval/consent flow. Drafting is agent work; the language is **not** in force
until the legal/privacy approval in Section 2 §8.

- [x] Produce the draft documents in `docs/`, claim-safe by policy (no SOC 2
      opinion, ISO/IEC 27001 certification, security guarantee, or auditor
      replacement). — `docs/codeattest-partner-disclosures-DRAFT.md` covers all
      five topics (disclosure, retention, deletion-request path, incident
      contact, per-bundle approval/consent), derived from `claim-safety.v0.json`
      and `codeattest-assurance-boundary.md`.
- [x] **Acceptance:** drafts exist and pass claim-safety checks; they are marked
      DRAFT pending §8 approval. — draft passes `npm run lint:public-content` and
      `check-format.mjs`; it carries a "DRAFT — not in force" banner pinned to
      §8 approval and states the assurance boundary governs on conflict.

> **Already landed (repository half of Section 2 §6).** The CI environment marker
> (`CI=true`) that makes `scripts/lib/cargo-gate.mjs` **fail** instead of skipping
> when Cargo is missing is wired and confirmed (2026-08-29). Installing the pinned
> toolchain in the *permanent* CI environment is the remaining human/infra half —
> see Section 2 §6.

---

# Section 2 — Human-only processes: provisioning, live evidence, and approvals

## 1. Provision the live environment (Sub-project F acceptance) — [INFRA]

Follow `infra/deploy/PROVISIONING.md`. On a native disk (never `/mnt/hgfs`,
which cannot symlink/hardlink), stand up:

- [ ] Dedicated Unix users for `codeattest-demo` and `codeattest-pilot`, isolated
      from each other at the OS level.
- [ ] Native-disk release roots under `/opt/codeattest/<identity>` with the
      `current` / `previous` / `web` symlink layout the deploy scripts expect.
- [ ] Two separate PostgreSQL clusters (demo and pilot), each with the
      `codeattest_app` role restricted to append-only grants and no `UPDATE` /
      `DELETE` on audit tables.
- [ ] Encrypted-at-rest storage for pilot source-derived objects (LUKS/dm-crypt),
      with the object root mounted on the encrypted device the boot probe checks.
- [ ] Mode-0600 host configs owned by the matching `codeattest-<identity>` user.
- [ ] DNS records and valid TLS certificates for the two hostnames.
- [ ] Caddy installed and validated (`caddy validate`) with the two-hostname
      routing template.
- [ ] Root-owned observability timer installed and firing, plus the off-box
      transparency-checkpoint anchor endpoint the C8 code publishes to.

Then prove it works:

- [ ] Both deployments pass external and loopback `/healthz` + `/readyz` smoke
      tests. Do **not** use real customer evidence as a smoke test.
- [ ] `deploy.sh` and `rollback.sh` run end to end against the real layout,
      including the pre-switch signed-runner-release verification.

## 2. Prove the persistence tier against a live database — [INFRA]

- [X] Run `npm run test --workspace @onevps/evidence-store` with a reachable
      PostgreSQL. **Done 2026-08-29** against a live PostgreSQL 17 instance on a
      provisioned host. Docker was unavailable, so the cluster and the
      `codeattest_migrator` / `codeattest_app` roles were stood up directly rather
      than via `infra/local/compose.yaml`. All three previously skip-clean Postgres
      tests executed for real — including the append-only grant tests and the
      timestamp-range projection parity. Running them live surfaced a latent test
      bug: `artifact-contract.mjs` reused one artifact digest across cases, so
      global content-addressing correctly returned `already_present` where the test
      asserted `stored`; fixed by minting a fresh sha256 digest per case (commit
      `293fee3`). The proving host is temporary — re-run against the pilot cluster
      during acceptance.

## 3. Establish production key custody and signed releases — [INFRA] [APPROVAL]

Signing is real ML-DSA-65, but custody is self-hosted software custody, not an
HSM. That limitation must be preserved verbatim in every claim and evidence
record; do not imply hardware protection.

- [ ] Provision distinct **managed signing keys** for demo and pilot.
- [ ] Generate the offline release **trust-anchor** keypair and keep its private
      key **off the VPS** entirely.
- [ ] Build the signed runner-release package from the exact release commit, with
      the non-empty trust anchor compiled in, and confirm the deployed runner
      reports `verified_release_signature` / `trusted_release`.
- [ ] Rehearse key rotation and revocation; confirm historical retired keys still
      verify as designed and that malformed / mismatched / revoked keys fail boot
      or verification.
- [ ] **Decide whether an HSM is required for launch.** If yes, this is
      additional hardware + a custody-migration change (see D2's file-backed,
      trust-anchor-signed key directory design — it is deliberately not a database
      table).

## 4. Close the four live control blockers (G Tasks 4–7) — [EVIDENCE] [APPROVAL]

The repository machinery exists for all of these; the live evidence and approvals
do not. See the seven-control matrix in the G acceptance plan.

- [ ] **Encryption at rest** — real `findmnt`/`cryptsetup` evidence for every
      pilot persistence and backup path; envelope-encryption known-answer and
      wrong-key drills; restart/restore drills; infrastructure-security approval.
- [ ] **Retention defaults** — live synthetic records with and without retained-
      source opt-in; durable expiry scheduler observed executing after restart;
      privacy/data-governance approval.
- [ ] **Deletion controls** — live operator-request and expiry-purge canaries;
      post-delete re-read confirming absence; durable `verified` deletion record +
      `evidence_deleted` event; two independent approvals.
- [ ] **Access control + access logging** — live positive/negative/failure-
      injection cases; one returned object correlates to exactly one persisted
      `evidence_accessed` event; failed logging returns no bytes; demo/pilot OS,
      DB, config, credential, session, tenant, review, and role separation proven;
      application-security and audit/logging approvals.

## 5. Run the candidate soak and append the final gate (G Tasks 8–10) — [EVIDENCE] [APPROVAL]

- [ ] Append a `partner_pilot_candidate` gate with both real-acceptance flags
      **false** and start the pilot against it.
- [ ] Run **72 consecutive synthetic-only hours**, ≥4,000 one-minute readiness
      samples, the retention/deletion destructive canaries, and every failure
      drill (denied read, forced log-write failure, wrong key, unsigned release).
      Restart the soak after any release or material config change.
- [ ] Collect one fresh, content-addressed, passing evidence record per control,
      each with an independent reviewer, no waivers, no `PENDING`-skipped tool.
- [ ] **[APPROVAL]** Two distinct final approvers (pilot security owner + pilot
      operations owner) approve the exact decision; neither approves a record they
      produced. Sign the approved decision with the pilot managed key.
- [ ] Dry-run then execute the transactional promotion to
      `partner_pilot_real_snippet_ready`, enabling only the specifically approved
      real-acceptance flag(s) and source-derived classes.
- [ ] Restart pilot, confirm it binds the exact new gate version, pass loopback +
      external `/readyz`, and confirm unapproved source-derived classes stay
      rejected. Open the partner route only then.
- [ ] Rehearse the append-only **deny-back** procedure: a higher candidate version
      disables both real-acceptance flags and boot/intake bind it.

## 6. Install the acceptance-grade CI toolchain — [INFRA]

`npm run ci` degrades gracefully when a toolchain is absent (Rust gates and the G6
Cargo steps report `PENDING` locally; required native verifiers may be missing).
The repository half — the `CI=true` marker that turns a missing Cargo into a hard
failure instead of a silent skip — is done (see Section 1's note). The remaining
work is installing the pinned toolchain in the permanent CI environment so every
required check actually executes.

- [X] Run CI with the pinned toolchain: Node **24.18.0**, TypeScript **6.0.3**,
      Rust **1.96.1** with Cargo, and no required check reporting `PENDING`.
      **Done 2026-08-29** on a temporary provisioned host: a full
      `CI=true npm run ci` completed green (exit 0) with the pinned toolchain
      installed and zero `PENDING` gates. **The permanent CI environment still
      needs the same toolchain installed for this to hold there.**
- [X] Ensure ShellCheck, `systemd-analyze`, `caddy validate`, and LUKS tooling are
      installed in the acceptance environment so the deploy/observability/gate
      checks produce captured results rather than skip messages. **Done 2026-08-29**
      for ShellCheck, `systemd-analyze`, and `caddy validate` — all executed for
      real in the green run. Running ShellCheck for real surfaced a false positive
      on `deploy.sh`'s trap-installed `rollback_failed_deploy` handler (SC2317 in
      addition to SC2329); fixed in commit `293fee3`. LUKS tooling is exercised only
      by the §4 encryption-at-rest path, which remains open.

## 7. Operational readiness — [INFRA] [APPROVAL]

- [ ] Provision the **real alert sink** the C7 code emits to, and define
      on-call/escalation. (The loopback timer and emit code are Section 1 C7; this
      is the destination and the human process behind it.)
- [ ] Implement and drill **backup + restore** for both clusters and the encrypted
      object store, preserving encryption on restore and documenting key
      separation.
- [ ] Stand up and validate the **off-box transparency-checkpoint anchor** that
      the C8 code publishes to, so the event-log transparency chain is externally
      anchored.
- [ ] The **`/readyz` post-boot database-liveness** gap is closed in code by
      Section 1 C2; verify it live during the §5 readiness sampling.

## 8. Claim-safety and legal review — [APPROVAL]

- [ ] Legal / compliance / audit review of all customer-visible claim language —
      including the C9 partner-facing disclosure/retention/deletion/incident/consent
      drafts — before any customer launch. Outputs must not imply a SOC 2 opinion,
      ISO/IEC 27001 certification, a guarantee of security, or replacement of an
      auditor (see `protocol/policies/claim-safety.v0.json` and
      `docs/codeattest-assurance-boundary.md`). The gate raise is **not** a
      substitute for per-submission customer consent.

---

## Definition of "production standard" for the pilot

All eight G definition-of-done conditions hold (see the G acceptance plan §4):
protocol can represent/validate/sign/persist the evidence and decision; all seven
controls pass live with independent review and no waivers; the four blockers are
closed with live synthetic evidence; a 72-hour candidate soak passes with real
acceptance structurally disabled; two distinct approvers sign the exact decision
and the transaction appends it without rewriting history; pilot restarts bound to
that version and passes internal/external readiness before its route opens; a
tested deny-back procedure works; and `npm run ci` + `acceptance:g-check` pass for
the exact release with Cargo, Postgres, and required native tools genuinely
exercised.

Section 1 gets the codebase to the point where those conditions *can* be tested;
Section 2 is where they are actually proven and approved. Until every one of the
Section 2 conditions is true, the correct environment remains
`partner_pilot_candidate` or `synthetic_demo`, and real customer source-derived
evidence stays out of bounds.
