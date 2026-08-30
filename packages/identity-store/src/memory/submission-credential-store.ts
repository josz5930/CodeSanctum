import type {
  CredentialRevocationReason,
  IssueSubmissionCredentialInput,
  SubmissionCredential,
  SubmissionCredentialStore
} from "../ports.js";

function asResolved(input: IssueSubmissionCredentialInput): SubmissionCredential {
  const credential: SubmissionCredential = {
    token_key_id: input.token_key_id,
    review_id: input.review_id,
    tenant_id: input.tenant_id,
    customer_id: input.customer_id,
    selected_application_id: input.selected_application_id,
    selected_commit: input.selected_commit,
    repository_identity_hash: input.repository_identity_hash,
    expected_manifest_id: input.expected_manifest_id,
    secret_hash: input.secret_hash
  };
  if (input.expected_evidence_bundle_id !== undefined) {
    credential.expected_evidence_bundle_id = input.expected_evidence_bundle_id;
  }
  return credential;
}

export function createMemorySubmissionCredentialStore(): SubmissionCredentialStore {
  const issued = new Map<string, IssueSubmissionCredentialInput>();
  const revocations = new Map<string, CredentialRevocationReason>();

  return {
    async issue(input) {
      if (issued.has(input.token_key_id)) {
        throw new Error(`submission credential already exists: ${input.token_key_id}`);
      }
      issued.set(input.token_key_id, {
        ...input,
        issued_at: new Date(input.issued_at.getTime()),
        expires_at: new Date(input.expires_at.getTime())
      });
    },

    async resolve(tokenKeyId, now) {
      const row = issued.get(tokenKeyId);
      if (row === undefined) {
        return undefined;
      }
      if (revocations.has(tokenKeyId)) {
        return undefined;
      }
      if (!(now < row.expires_at)) {
        return undefined;
      }
      return asResolved(row);
    },

    async revoke(tokenKeyId, reason) {
      if (!issued.has(tokenKeyId) || revocations.has(tokenKeyId)) {
        return;
      }
      revocations.set(tokenKeyId, reason);
    }
  };
}
