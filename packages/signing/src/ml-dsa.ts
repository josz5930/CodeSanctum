import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export const ML_DSA_65_SIGNATURE_BYTES = 3309;
export const ML_DSA_65_PUBLIC_KEY_BYTES = 1952;

/**
 * The fixed 22-byte SPKI DER prefix for an ML-DSA-65 public key: a SEQUENCE
 * wrapping the algorithm OID 2.16.840.1.101.3.4.3.18 and a BIT STRING. The
 * protocol carries raw 1952-byte keys; `node:crypto` imports SPKI, so this
 * prefix converts between them. Verified against a Node-generated key.
 */
const SPKI_PREFIX = Buffer.from("308207b2300b0609608648016503040312038207a100", "hex");

export function generateMlDsa65KeyPair(): { publicKey: Uint8Array; privateKeyPkcs8: Uint8Array } {
  const pair = generateKeyPairSync("ml-dsa-65");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    publicKey: new Uint8Array(spki.subarray(spki.length - ML_DSA_65_PUBLIC_KEY_BYTES)),
    privateKeyPkcs8: new Uint8Array(pair.privateKey.export({ format: "der", type: "pkcs8" }))
  };
}

/**
 * ML-DSA signing in Node is randomized (hedged) and exposes no deterministic
 * mode, so the same key and message produce different bytes each call. Never
 * assert on this output; verify it instead.
 */
export function signMlDsa65(privateKeyPkcs8: Uint8Array, message: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.from(privateKeyPkcs8), format: "der", type: "pkcs8" });
  return new Uint8Array(sign(null, Buffer.from(message), key));
}

/** Wrong-length or malformed inputs return false rather than throwing, because these come off the wire. */
export function verifyMlDsa65(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== ML_DSA_65_PUBLIC_KEY_BYTES || signature.length !== ML_DSA_65_SIGNATURE_BYTES) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey)]),
      format: "der",
      type: "spki"
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function publicKeyFromPkcs8(privateKeyPkcs8: Uint8Array): Uint8Array | undefined {
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(privateKeyPkcs8), format: "der", type: "pkcs8" });
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    const raw = new Uint8Array(spki.subarray(spki.length - ML_DSA_65_PUBLIC_KEY_BYTES));
    return raw.length === ML_DSA_65_PUBLIC_KEY_BYTES ? raw : undefined;
  } catch {
    return undefined;
  }
}
