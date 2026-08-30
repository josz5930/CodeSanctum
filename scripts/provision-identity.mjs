import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { compileWorkspace } from "../packages/identity-store/test/helpers/compile.mjs";

const {
  hashSecret,
  mintTotpSecret,
  sealTotpSecret,
  createPostgresSessionStore,
  createPostgresSubmissionCredentialStore
} = await compileWorkspace("index.js");

const ROLES = new Set([
  "customer_admin",
  "customer_viewer",
  "codeattest_reviewer",
  "codeattest_ops",
  "evidence_consumer_static"
]);
const REVOKE_REASONS = new Set(["rotated", "operator_revoked", "review_closed"]);
const TOTP_ISSUER = "CodeAttest";

const USAGE = `usage:
  node scripts/provision-identity.mjs tenant create --tenant-id <id> --display-name <name>
  node scripts/provision-identity.mjs account create --tenant-id <id> --identifier <email> --role <role> [--review-scope <review:...>]
  node scripts/provision-identity.mjs account reset-secret --identifier <email>
  node scripts/provision-identity.mjs totp enroll --identifier <email>
  node scripts/provision-identity.mjs credential issue --review-id <review:...> --tenant-id <id> --application-id <id> --commit <sha> --repository-identity-hash <sha256:...> --expected-manifest-id <sha256:...> [--days 30]
  node scripts/provision-identity.mjs credential revoke --token-key-id <id> --reason operator_revoked

Connects as the migrator role (--database-url or CODEATTEST_DATABASE_URL).
totp enroll also needs --encryption-key-file, or CREDENTIALS_DIRECTORY plus --encryption-key-ref.`;

function flag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function requireFlag(name) {
  const value = flag(name);
  if (value === undefined || value.length === 0) {
    console.error(`missing ${name}`);
    console.error(USAGE);
    process.exit(1);
  }
  return value;
}

function databaseUrl() {
  const url = flag("--database-url") ?? process.env.CODEATTEST_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    console.error("usage: provision-identity requires --database-url <url> or CODEATTEST_DATABASE_URL");
    process.exit(1);
  }
  return url;
}

function mintSecret() {
  return randomBytes(32).toString("base64url");
}

function mintAccountId() {
  return `account:${randomBytes(8).toString("hex")}`;
}

function mintTokenKeyId() {
  return randomBytes(16).toString("hex");
}

async function loadTotpKey() {
  const direct = flag("--encryption-key-file");
  const path = direct !== undefined
    ? direct
    : (() => {
        const directory = process.env.CREDENTIALS_DIRECTORY;
        const keyRef = flag("--encryption-key-ref");
        if (directory === undefined || directory.length === 0 || keyRef === undefined) {
          console.error("totp enroll requires --encryption-key-file, or CREDENTIALS_DIRECTORY plus --encryption-key-ref");
          process.exit(1);
        }
        return join(directory, keyRef);
      })();
  const bytes = await readFile(path);
  if (bytes.length !== 32) {
    throw new Error("TOTP encryption key must be 32 bytes");
  }
  return bytes;
}

async function withMigrator(fn) {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function tenantCreate() {
  const tenantId = requireFlag("--tenant-id");
  const displayName = requireFlag("--display-name");
  await withMigrator(async (client) => {
    await client.query(
      "INSERT INTO tenant (tenant_id, display_name) VALUES ($1, $2)",
      [tenantId, displayName]
    );
  });
  console.log(`tenant_id=${tenantId}`);
}

async function accountCreate() {
  const tenantId = requireFlag("--tenant-id");
  const identifier = requireFlag("--identifier").toLowerCase();
  const role = requireFlag("--role");
  if (!ROLES.has(role)) {
    console.error(`role must be one of: ${[...ROLES].join(", ")}`);
    process.exit(1);
  }
  const reviewScope = flag("--review-scope") ?? null;
  const accountId = mintAccountId();
  const secret = mintSecret();
  const secretHash = hashSecret(secret);
  await withMigrator(async (client) => {
    await client.query(
      "INSERT INTO account (account_id, tenant_id, identifier, secret_hash) VALUES ($1, $2, $3, $4)",
      [accountId, tenantId, identifier, secretHash]
    );
    await client.query(
      "INSERT INTO account_role_grant (account_id, role, review_scope) VALUES ($1, $2, $3)",
      [accountId, role, reviewScope]
    );
  });
  console.log(`account_id=${accountId}`);
  console.log(`identifier=${identifier}`);
  console.log(`secret=${secret}`);
}

async function accountResetSecret() {
  const identifier = requireFlag("--identifier").toLowerCase();
  const secret = mintSecret();
  const secretHash = hashSecret(secret);
  await withMigrator(async (client) => {
    const result = await client.query(
      "UPDATE account SET secret_hash = $1 WHERE identifier = $2 RETURNING account_id",
      [secretHash, identifier]
    );
    if (result.rowCount === 0) {
      throw new Error(`no account for identifier ${identifier}`);
    }
    const accountId = result.rows[0]?.account_id;
    if (typeof accountId !== "string") {
      throw new Error(`no account for identifier ${identifier}`);
    }
    // Existing cookies must not survive a password reset.
    await createPostgresSessionStore(client).revokeAllForAccount(accountId, "operator_revoked");
  });
  console.log(`identifier=${identifier}`);
  console.log(`secret=${secret}`);
}

async function totpEnroll() {
  const identifier = requireFlag("--identifier").toLowerCase();
  const key = await loadTotpKey();
  const minted = mintTotpSecret();
  const box = sealTotpSecret(minted.secret, key);
  await withMigrator(async (client) => {
    const result = await client.query(
      "UPDATE account SET totp_secret_box = $1 WHERE identifier = $2",
      [box, identifier]
    );
    if (result.rowCount === 0) {
      throw new Error(`no account for identifier ${identifier}`);
    }
  });
  const label = encodeURIComponent(`${TOTP_ISSUER}:${identifier}`);
  const uri = `otpauth://totp/${label}?secret=${minted.base32}&issuer=${encodeURIComponent(TOTP_ISSUER)}`;
  console.log(`base32=${minted.base32}`);
  console.log(uri);
}

async function credentialIssue() {
  const reviewId = requireFlag("--review-id");
  const tenantId = requireFlag("--tenant-id");
  const applicationId = requireFlag("--application-id");
  const commit = requireFlag("--commit");
  const repositoryIdentityHash = requireFlag("--repository-identity-hash");
  const expectedManifestId = requireFlag("--expected-manifest-id");
  const daysRaw = flag("--days") ?? "30";
  const days = Number(daysRaw);
  if (!Number.isInteger(days) || days < 1) {
    console.error("--days must be a positive integer");
    process.exit(1);
  }
  const tokenKeyId = mintTokenKeyId();
  const secret = mintSecret();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);
  await withMigrator(async (client) => {
    const store = createPostgresSubmissionCredentialStore(client);
    await store.issue({
      token_key_id: tokenKeyId,
      review_id: reviewId,
      tenant_id: tenantId,
      customer_id: tenantId,
      selected_application_id: applicationId,
      selected_commit: commit,
      repository_identity_hash: repositoryIdentityHash,
      expected_manifest_id: expectedManifestId,
      secret_hash: hashSecret(secret),
      issued_at: issuedAt,
      expires_at: expiresAt
    });
  });
  console.log(`token_key_id=${tokenKeyId}`);
  console.log(`secret=${secret}`);
  console.log(`expires_at=${expiresAt.toISOString()}`);
}

async function credentialRevoke() {
  const tokenKeyId = requireFlag("--token-key-id");
  const reason = requireFlag("--reason");
  if (!REVOKE_REASONS.has(reason)) {
    console.error(`reason must be one of: ${[...REVOKE_REASONS].join(", ")}`);
    process.exit(1);
  }
  await withMigrator(async (client) => {
    const store = createPostgresSubmissionCredentialStore(client);
    await store.revoke(tokenKeyId, reason);
  });
  console.log(`token_key_id=${tokenKeyId}`);
  console.log(`reason=${reason}`);
}

async function main() {
  const resource = process.argv[2];
  const action = process.argv[3];
  const command = `${resource ?? ""} ${action ?? ""}`.trim();
  switch (command) {
    case "tenant create":
      await tenantCreate();
      return;
    case "account create":
      await accountCreate();
      return;
    case "account reset-secret":
      await accountResetSecret();
      return;
    case "totp enroll":
      await totpEnroll();
      return;
    case "credential issue":
      await credentialIssue();
      return;
    case "credential revoke":
      await credentialRevoke();
      return;
    default:
      console.error(USAGE);
      process.exit(1);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`provision-identity failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
