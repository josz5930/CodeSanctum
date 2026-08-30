import type { SubmissionCredential, SubmissionCredentialStore } from "../ports.js";

type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}

function asCredential(row: Record<string, unknown>): SubmissionCredential {
  const credential: SubmissionCredential = {
    token_key_id: row.token_key_id as string,
    review_id: row.review_id as string,
    tenant_id: row.tenant_id as string,
    customer_id: row.customer_id as string,
    selected_application_id: row.selected_application_id as string,
    selected_commit: row.selected_commit as string,
    repository_identity_hash: row.repository_identity_hash as string,
    expected_manifest_id: row.expected_manifest_id as string,
    secret_hash: row.secret_hash as string
  };
  if (typeof row.expected_evidence_bundle_id === "string") {
    credential.expected_evidence_bundle_id = row.expected_evidence_bundle_id;
  }
  return credential;
}

export function createPostgresSubmissionCredentialStore(sql: SqlExecutor): SubmissionCredentialStore {
  return {
    async issue(input) {
      try {
        await sql.query(
          `INSERT INTO submission_credential (
             token_key_id, review_id, tenant_id, customer_id,
             selected_application_id, selected_commit, repository_identity_hash,
             expected_manifest_id, expected_evidence_bundle_id, secret_hash,
             issued_at, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            input.token_key_id,
            input.review_id,
            input.tenant_id,
            input.customer_id,
            input.selected_application_id,
            input.selected_commit,
            input.repository_identity_hash,
            input.expected_manifest_id,
            input.expected_evidence_bundle_id ?? null,
            input.secret_hash,
            input.issued_at,
            input.expires_at
          ]
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error(`submission credential already exists: ${input.token_key_id}`);
        }
        throw error;
      }
    },

    async resolve(tokenKeyId, now) {
      const { rows } = await sql.query(
        `SELECT c.token_key_id, c.review_id, c.tenant_id, c.customer_id,
                c.selected_application_id, c.selected_commit, c.repository_identity_hash,
                c.expected_manifest_id, c.expected_evidence_bundle_id, c.secret_hash
           FROM submission_credential c
           LEFT JOIN submission_credential_revocation r ON r.token_key_id = c.token_key_id
          WHERE c.token_key_id = $1
            AND r.token_key_id IS NULL
            AND c.expires_at > $2`,
        [tokenKeyId, now]
      );
      const row = rows[0];
      return row === undefined ? undefined : asCredential(row);
    },

    async revoke(tokenKeyId, reason) {
      await sql.query(
        `INSERT INTO submission_credential_revocation (token_key_id, reason)
         SELECT c.token_key_id, $2
           FROM submission_credential c
          WHERE c.token_key_id = $1
         ON CONFLICT (token_key_id) DO NOTHING`,
        [tokenKeyId, reason]
      );
    }
  };
}
