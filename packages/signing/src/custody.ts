import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import { publicKeyFromPkcs8 } from "./ml-dsa.js";

export type CredentialLoad =
  | { ok: true; privateKeyPkcs8: Uint8Array; publicKey: Uint8Array }
  | { ok: false; reason: "credential_directory_missing" | "credential_missing" | "credential_readable_by_others" | "credential_malformed" };

export async function loadSigningCredential(input: { credentialsDirectory: string | undefined; credentialName: string }): Promise<CredentialLoad> {
  if (input.credentialsDirectory === undefined || input.credentialsDirectory.length === 0) {
    return { ok: false, reason: "credential_directory_missing" };
  }
  const credentialPath = path.join(input.credentialsDirectory, input.credentialName);
  let mode: number;
  try {
    mode = (await stat(credentialPath)).mode & 0o777;
  } catch {
    return { ok: false, reason: "credential_missing" };
  }
  if ((mode & 0o077) !== 0) return { ok: false, reason: "credential_readable_by_others" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(credentialPath));
  } catch {
    return { ok: false, reason: "credential_missing" };
  }
  const publicKey = publicKeyFromPkcs8(bytes);
  if (publicKey === undefined) return { ok: false, reason: "credential_malformed" };
  return { ok: true, privateKeyPkcs8: bytes, publicKey };
}
