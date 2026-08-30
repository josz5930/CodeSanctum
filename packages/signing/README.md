# Signing Package

Real ML-DSA-65 (FIPS 204) signing and verification for CodeAttest. Both custody paths — the enrolled runner key on a customer's machine and the managed key held by the service — sign and verify through the helpers here, so no service, app, or adapter hand-rolls signature handling.

This is a private-capable vendor package. **Nothing here is a protocol artifact.** The signature envelope shape, canonicalization, and identity-signing input all live in `protocol/` and arrive through `@onevps/protocol-ts`; this package is the cryptographic implementation of those contracts, not a redefinition of them.

## What lives here

- `src/ml-dsa.ts` — the ML-DSA-65 primitive over `node:crypto`: key generation, PKCS#8/SPKI conversion for the raw 1952-byte public keys and 3309-byte signatures the protocol carries, and raw sign/verify. The fixed SPKI DER prefix bridges the protocol's raw keys and Node's SPKI import.
- `src/signed-message.ts` — the domain tag (`codeattest-ml-dsa-65-v1`) prefixed to canonical bytes before signing, so a signature over one scheme's bytes can never be replayed as another's. Kept byte-identical to `SIGNED_MESSAGE_DOMAIN` in `runner/crates/local-runner-scaffold/src/ml_dsa.rs`, which is what makes Rust-produced and TypeScript-produced signatures cross-verify.
- `src/envelope.ts` — build and verify a protocol `SignatureEnvelope` over a canonical `IdentitySigningInput`, resolving the signing key against a `SigningKeyDirectory`.
- `src/key-directory.ts` — resolve a key from a signed key directory and classify trust failures (unknown, revoked, outside validity window, algorithm mismatch) instead of collapsing them to a single "bad signature".
- `src/custody.ts` — load a signing credential from a directory, refusing a missing directory, a missing credential, a world-/group-readable credential file, or malformed key material.
- `src/runner-release.ts` — sign and verify offline runner-release records, binding a binary digest, signature, and build metadata; carries the `SOFTWARE_CUSTODY_LIMITATION` disclosure string.
- `src/base64url.ts` — strict unpadded base64url encode/decode. Node's decoder is lenient (accepts padding, standard-base64 characters, and silently truncates a trailing partial character); protocol bytes come off the wire, so anything but exact unpadded base64url is rejected rather than quietly reinterpreted.

## Invariants enforced here, not by convention

- **Cross-language signatures verify both ways.** The domain tag, canonicalization, and raw key/signature encodings match the Rust runner byte-for-byte. `test/cross-verification.test.mjs` signs in one language's shape and verifies in the other's.
- **Custody is fail-closed.** A credential that is missing, malformed, or readable by other users is refused, never signed with.
- **Trust failures stay distinct.** An unknown, revoked, expired, or algorithm-mismatched key each has its own outcome, so callers can log and message precisely.
- **Not protocol.** Keys, envelopes, and credential handling are runtime cryptography. They must not appear in fixtures, schemas, or customer-visible projections unless a later change starts in `protocol/`.

## Custody note

Signing is real ML-DSA-65, but key custody today is self-hosted software custody in a non-validated cryptographic module, **not** a hardware security module. `SOFTWARE_CUSTODY_LIMITATION` in `src/runner-release.ts` is the canonical wording for that boundary.

## Dependency direction

Depends only on `@onevps/protocol-ts` (imported by deep relative path) and `node:crypto`. No new third-party cryptographic dependency is introduced.
