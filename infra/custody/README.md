# Key custody

Two tiers, matching the real ML-DSA-65 signing design implemented in [`packages/signing/`](../../packages/signing/README.md).

## Tier 1 — the offline trust anchor

Generated on an air-gapped machine. Never present on the VPS in any form, in
any file, at any time. Its only job is to sign `signing-key-directory`
documents. The release-signing anchor described below is a separate key pair.

Generate it once:

```bash
node -e 'const {generateKeyPairSync}=require("node:crypto");const {privateKey}=generateKeyPairSync("ml-dsa-65");require("node:fs").writeFileSync("anchor.pkcs8.der",privateKey.export({format:"der",type:"pkcs8"}),{mode:0o600});'
```

Record the public key — `node scripts/sign-key-directory.mjs` prints it, and it
goes into every deployment's `signing.trust_anchor_public_key`.

## Tier 2 — the online signing key, one per deployment

Demo and pilot hold separate keys. A shared key would reintroduce, at the
cryptographic layer, the demo-reaches-pilot coupling that the runtime spine's
deployment isolation (§5.5) makes a filesystem fact.

Generate on the deployment host, then immediately seal it. Run this once with
`DEPLOYMENT=demo` and again with `DEPLOYMENT=pilot`; do not copy either
credential or key-directory record between them:

```bash
DEPLOYMENT=demo
node -e 'const {generateKeyPairSync}=require("node:crypto");const {privateKey}=generateKeyPairSync("ml-dsa-65");require("node:fs").writeFileSync("signing-key.pkcs8.der",privateKey.export({format:"der",type:"pkcs8"}),{mode:0o600});'
systemd-creds encrypt --name=signing-key signing-key.pkcs8.der "/etc/codeattest/$DEPLOYMENT/signing-key.cred"
shred -u signing-key.pkcs8.der
```

`systemd-creds encrypt` seals to the TPM where the VPS exposes one and to the
host key where it does not. Add to the unit:

```ini
LoadCredentialEncrypted=signing-key:/etc/codeattest/demo/signing-key.cred
```

systemd decrypts it into the unit's private `$CREDENTIALS_DIRECTORY`, a
per-unit tmpfs readable only by that service's user. The host reads it from
there; boot step 6 fails closed if it is absent, malformed, or does not derive
the public key the bound directory advertises.

## Publishing a directory

1. On the air-gapped machine, edit the unsigned directory document: bump
   `directory_version`, add the new record, mark the outgoing record
   `retired`.
2. `node scripts/sign-key-directory.mjs --directory d.json --anchor-key anchor.pkcs8.der --anchor-key-id codeattest-offline-trust-anchor --anchor-key-version v1 --signing-time <now> --out d.signed.json`
3. Copy `d.signed.json` to the deployment's `signing.key_directory_path`.
4. Restart the unit. If the new directory does not vouch for the key the host
   holds, it will not come back up — which is the intended failure.

Never edit a record in place, and never re-sign an existing
`directory_version`. Rotation and revocation are both new versions; that is
what makes the key history an audit record rather than a mutable setting.

## Offline runner-release anchor

Runner releases use a third ML-DSA-65 key pair, distinct from the directory
anchor and both online deployment keys. Its private key stays on the controlled
release builder and must never be copied to the VPS. Generate it as in Tier 1,
then export the raw public key:

```bash
node -e 'const fs=require("node:fs"),c=require("node:crypto");const k=c.createPrivateKey({key:fs.readFileSync("release-anchor.pkcs8.der"),format:"der",type:"pkcs8"});const s=c.createPublicKey(k).export({format:"der",type:"spki"});fs.writeFileSync("release-trust-anchor.pub",s.subarray(s.length-1952).toString("base64url")+"\n",{mode:0o644});'
```

Install only `release-trust-anchor.pub` at
`/etc/codeattest/release-trust-anchor.pub`, owned by root and not writable by
group or other. The signed-release builder verifies that this public key and
the supplied private key are a pair before compiling the public key into the
runner. The deploy and rollback paths independently pin the same public file.

Key custody is self-hosted software custody in a non-validated cryptographic
module, not a hardware security module.

## Rotation and revocation

- **Rotation:** new `key_version`, new directory version, previous record
  becomes `retired`. History keeps verifying.
- **Revocation:** the record becomes `revoked`. Everything it ever signed stops
  verifying, including history already issued. That is what revocation means.
