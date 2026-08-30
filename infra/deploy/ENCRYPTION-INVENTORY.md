# Encryption Inventory (G Task 4)

This inventory lists where source-derived bytes can land on the single-VPS
pilot and how each path is closed. It is operator evidence, not an approval
and not a claim that any live control passed.

Backup keys stay off the ciphertext volume. Restore is a LUKS open of the
pilot data volume plus a Postgres restore into that same volume; a missing or
wrong envelope key fails closed and does not yield plaintext objects.

| Path | Holds source-derived bytes? | Control |
| --- | --- | --- |
| Object store under `/var/lib/codeattest/pilot/objects` | Yes, ciphertext only | AES-256-GCM envelope plus LUKS backing probe at boot |
| Object-store `.tmp` files | Transient ciphertext during put | Atomic rename; leftover temps fail the collector |
| Postgres `artifact_reference.body` | No; classification metadata only | Bytes never written to SQL |
| Postgres data directory | No source-derived object bytes | Must live on the same LUKS volume; envelope ciphertext is not in SQL |
| Temporary upload / submission staging | No source-derived object bytes | Three-phase transport writes content-addressed objects, not a separate plaintext drop |
| systemd/journald logs | No source-derived object bytes | Host metric records redact secret headers and do not log artifact bytes |
| Crash / core dumps | Must not retain plaintext source | Envelope wrap happens before the filesystem write |
| Native release roots under `/opt/codeattest/pilot` | No customer source | Built artifacts and configs only |
| Backups of the LUKS volume | Ciphertext + Postgres metadata | Backup key material is stored separately from the backup image |

A source-derived put without the deployment envelope key returns
`encryption_unavailable`. A get with the wrong key returns `decryption_failed`
and no bytes.
