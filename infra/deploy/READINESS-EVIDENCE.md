# Readiness Evidence Collection

Private operator instructions for G Task 3. This runbook records redacted,
reproducible observations for the seven environment-readiness controls. It does
not raise an environment gate and does not authorize real customer
source-derived evidence.

Do not paste secrets into a shared terminal transcript. Do not copy database
URLs, session cookies, TOTP material, private keys, or customer identifiers
into an attachment. The collector redacts those classes before hashing; treat
any unredacted capture as a failed observation and discard it.

## 1. Bind the exact release

Record the release digest and deployment identity of the candidate being
evidenced. Every observation must carry that pair. A result from another
commit, config, or deployment is refused.

```sh
node scripts/collect-readiness-evidence.mjs \
  --check-id identity-c-check \
  --command "npm run identity:c-check" \
  --stdout-file /tmp/identity-c-check.stdout \
  --exit-status 0 \
  --tool-version "node-24.18.0" \
  --release-digest sha256:<exact-release> \
  --expected-release-digest sha256:<exact-release> \
  --deployment-identity pilot \
  --output-dir /var/lib/codeattest/pilot/readiness-evidence
```

The command writes a redacted attachment, an observation JSON record, and a
`rerun-manifest.json`. The observation stores command, exit status, tool
version, UTC collection time, release digest, deployment identity, and the
SHA-256 of the redacted attachment.

## 2. Refuse skips

Required-tool `PENDING` skips, missing binaries, and "skipped: no database"
results are refusals, not evidence. Re-run with the tool present. Optional
checks may pass `--optional`; they still cannot be used to approve a control.

## 3. Synthetic canaries

Deterministic canary inputs live in
[`readiness-canaries/`](./readiness-canaries/). Each file is marked
`SYNTHETIC_DEMO_DATA` / `NOT_CUSTOMER_SOURCE`. An independent reviewer reruns
an observation by executing the recorded command against the same canary and
comparing the redacted attachment digest in `rerun-manifest.json`.

## 4. Release-trust evidence

Run the exact-release repository gate with Cargo present, then independently
verify the transferred release package against the pinned public anchor:

```sh
npm run release-trust:g6-check > /tmp/release-trust-g6.stdout 2>&1
node scripts/verify-runner-release.mjs \
  --release-dir /secure-transfer/codeattest-runner-release \
  --trust-anchor /etc/codeattest/release-trust-anchor.pub \
  --expected-build-identifier "$(git rev-parse HEAD)" \
  > /tmp/runner-release-verification.stdout 2>&1
```

Collect both outputs through the redacting collector. The release-security
package must additionally capture, from the exact candidate environment:

- demo and pilot key IDs/public-key digests proving the active managed keys are
  distinct, plus verification of both offline-anchor-signed directories;
- boot key self-tests and pilot receipt/static-bundle sign-and-verify results;
- historical retired-key verification, rotation, and revocation rehearsals;
- wrong-key, malformed-directory, unsigned-release, and digest-mismatch
  refusals; and
- absence of the directory-anchor and runner-release-anchor private keys from
  the VPS credential/path inventory.

Do not collect private/public key bytes, credentials, or signed customer data.
The evidence record limitations must include this exact sentence:

> Key custody is self-hosted software custody in a non-validated cryptographic module, not a hardware security module.

A green repository check is design/repository evidence only. The control stays
failed until an independent cryptography/release-security reviewer approves the
fresh live package.

## 5. After collection

Feed passing observation identities into the G Task 2 promotion command. Live
infrastructure-security, privacy, and operations approvals remain separate
human steps and are not implied by a green collector run.
