# Backup and Restore

[`backup.sh`](./backup.sh) and [`restore.sh`](./restore.sh) back up and
restore one deployment's PostgreSQL database and object store. They close the
repository half of Section 2 §7 of the
[production-readiness guide](../../docs/codeattest-production-readiness.md).
The human half stays open: a drill on the provisioned pilot, an off-box copy,
and the approvals the guide names.

## What a backup holds

Each run writes one directory, `<backup-root>/<identity>/<UTC-timestamp>/`,
root-owned and mode `0700`:

| File | Contents |
| --- | --- |
| `database.dump` | `pg_dump --format=custom` of the deployment database, taken as the cluster superuser over the local socket |
| `objects.tar` | The object store as it is on disk: ciphertext only when the envelope key is set |
| `INFO` | Identity, timestamp, migration head, and the deployed release path |
| `SHA256SUMS` | Digests of the three files above |

A backup holds **no keys**: not the TOTP key, the envelope key, the signing
credential, or the migrator URL. Back up `/etc/codeattest/<identity>/` through
the offline custody path in [`../custody/README.md`](../custody/README.md),
and never store those keys next to a data backup. Without the envelope key the
objects in a backup cannot be read, and that separation is the intended
control (see [`ENCRYPTION-INVENTORY.md`](./ENCRYPTION-INVENTORY.md)).

The database dump is not encrypted by the script. It holds review history,
identities, password hashes, sealed TOTP secrets, and receipts. So:

- a **pilot** backup must be written to an encrypted (LUKS/dm-crypt) device;
  `backup.sh` refuses any other destination;
- a **demo** backup on an unencrypted device prints a warning.

## Taking a backup

```sh
sudo infra/deploy/backup.sh demo /var/backups/codeattest
sudo infra/deploy/backup.sh pilot /mnt/codeattest-backup   # an encrypted mount
```

The script reads the object root and database port from
`/etc/codeattest/<identity>-host.json`, so it backs up what the host serves.
It stops the retention timer for the length of the run, because a purge
between the dump and the archive would leave the backup naming an object it
does not hold, and starts it again afterwards. The host keeps serving: new
rows written after the dump are not in this backup; new objects may be, and
nothing reads an object that no restored row refers to.

Before it publishes the directory, the script proves `pg_restore --list` and
`tar -t` can read what it wrote. A failed run leaves no partial directory.

### Schedule and off-box copy

Run it from a root timer or cron at least daily, for example:

```cron
17 3 * * * root /opt/codeattest/demo/current/infra/deploy/backup.sh demo /var/backups/codeattest
```

A backup on the same VPS does not survive the loss of that VPS. Copy each
completed directory off the box (for example `rsync` or `rclone` to storage
that encrypts at rest) and keep the keys in a different place from the data.

### How long backups are kept

`CODEATTEST_BACKUP_KEEP` (default `7`) is the number of complete backups the
script keeps for an identity; it deletes older ones after each successful run.
Evidence that a retention purge or a deletion request removed from the live
system **stays in older backups until they age out**. State that window in the
retention and deletion language you give partners
([partner disclosures draft](../../docs/codeattest-partner-disclosures-DRAFT.md)),
and apply the same window to the off-box copies.

## Restoring

Restore runs only into an **empty** database and an **empty** object store.
The history is append-only, so the script never merges a backup into live data
or replaces it. If you must replace live data, a human drops and re-creates the
database and empties the object root by hand first.

1. Provision the host as in [`PROVISIONING.md`](./PROVISIONING.md) sections
   2–5: the users, the cluster with both roles, an empty `codeattest`
   database, the object root (on the LUKS volume for pilot), the host config,
   the migrator URL file, and the keys restored from offline custody. Do not
   run the migrations or seed the gate; the backup holds both.
2. Restore:

   ```sh
   sudo infra/deploy/restore.sh pilot /mnt/codeattest-backup/pilot/20260101T031700Z
   ```

   The script checks every digest in `SHA256SUMS` and that the backup came from
   this identity. It refuses a non-empty target and, for pilot, an object root
   that is not on an encrypted device. It stops the deployment's services,
   restores the database in one transaction as the cluster superuser, unpacks
   the objects, and gives them to `codeattest-<identity>`.
3. If a release is already deployed, the script applies any migrations that
   release has and the backup lacks, starts the services, and waits for
   `/readyz`. If not, run `deploy.sh` next.

## Drill

A backup that has not been restored is not known to work. On a scratch host or
cluster, at least once per release that changes a migration:

1. take a backup;
2. restore it into a fresh cluster and object root;
3. compare `pg_dump --data-only` of the source and the restored database (only
   the random `\restrict` line differs);
4. confirm the host boots, `/readyz` passes, an envelope-encrypted object reads
   back with the right key, and the same object fails with a wrong key;
5. record the result as Section 2 §7 evidence.
