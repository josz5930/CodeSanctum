import type { SigningKeyDirectory } from "../../../packages/protocol-ts/src/index.js";
import type { SigningKeyHandle } from "../../../packages/signing/src/index.js";
import { decodeBase64Url, encodeBase64Url, loadSigningCredential, resolveSigningKey, verifyKeyDirectory } from "../../../packages/signing/src/index.js";

import type { HostConfig } from "./config.js";

export type SigningKeyCheckInput = {
  config: Pick<HostConfig, "signing">;
  credentialsDirectory: string | undefined;
  readKeyDirectory: (keyDirectoryPath: string) => Promise<string>;
  now: () => string;
};

export type SigningKeyCheckResult =
  | { ok: true; key: SigningKeyHandle; directory: SigningKeyDirectory }
  | { ok: false; reason: string };

export async function checkSigningKey(input: SigningKeyCheckInput): Promise<SigningKeyCheckResult> {
  const signing = input.config.signing;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await input.readKeyDirectory(signing.key_directory_path));
  } catch {
    return { ok: false, reason: "signing_key_directory_unreadable" };
  }
  const anchor = decodeBase64Url(signing.trust_anchor_public_key);
  if (anchor === undefined || !verifyKeyDirectory(parsed, anchor)) {
    return { ok: false, reason: "signing_key_directory_untrusted" };
  }
  const directory = parsed as SigningKeyDirectory;
  const credential = await loadSigningCredential({ credentialsDirectory: input.credentialsDirectory, credentialName: signing.credential_name });
  if (!credential.ok) return { ok: false, reason: `signing_key_${credential.reason}` };
  const resolution = resolveSigningKey(directory, {
    key_id: signing.key_id,
    key_version: signing.key_version,
    signing_time: input.now(),
    purpose: "sign"
  });
  if (!resolution.ok) return { ok: false, reason: "signing_key_not_active_in_directory" };
  if (resolution.record.public_key !== encodeBase64Url(credential.publicKey)) {
    return { ok: false, reason: "signing_key_public_key_mismatch" };
  }
  return {
    ok: true,
    key: { key_id: signing.key_id, key_version: signing.key_version, privateKeyPkcs8: credential.privateKeyPkcs8 },
    directory
  };
}
