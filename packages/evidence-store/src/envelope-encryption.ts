import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SOURCE_DERIVED_CLASSES = new Set([
  "transient_source_derived",
  "customer_opt_in_retained_source"
]);

const MAGIC = Buffer.from("CAE1");
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

export type EnvelopeKey = {
  keyId: string;
  key: Uint8Array;
};

export function isSourceDerivedClass(value: string): boolean {
  return SOURCE_DERIVED_CLASSES.has(value);
}

export function isEnvelope(bytes: Uint8Array | undefined): boolean {
  if (bytes === undefined || bytes.byteLength < MAGIC.length) {
    return false;
  }
  return Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function wrapEnvelope(plaintext: Uint8Array, envelope: EnvelopeKey): Uint8Array {
  if (envelope.key.byteLength !== 32) {
    throw new Error("envelope key must be 32 bytes");
  }
  const keyId = Buffer.from(envelope.keyId, "utf8");
  if (keyId.byteLength < 1 || keyId.byteLength > 64) {
    throw new Error("envelope key id must be 1-64 bytes");
  }
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(envelope.key), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([MAGIC, Buffer.from([keyId.byteLength]), keyId, nonce, ciphertext, tag]));
}

export function unwrapEnvelope(
  bytes: Uint8Array,
  envelope: EnvelopeKey
): { ok: true; plaintext: Uint8Array } | { ok: false; reason: "not_envelope" | "wrong_key" } {
  if (!isEnvelope(bytes)) {
    return { ok: false, reason: "not_envelope" };
  }
  if (envelope.key.byteLength !== 32) {
    return { ok: false, reason: "wrong_key" };
  }
  const buffer = Buffer.from(bytes);
  const keyIdLength = buffer[MAGIC.length];
  if (keyIdLength === undefined || keyIdLength < 1 || keyIdLength > 64) {
    return { ok: false, reason: "wrong_key" };
  }
  const keyIdStart = MAGIC.length + 1;
  const keyIdEnd = keyIdStart + keyIdLength;
  const nonceStart = keyIdEnd;
  const nonceEnd = nonceStart + NONCE_LENGTH;
  const tagStart = buffer.length - TAG_LENGTH;
  if (tagStart < nonceEnd) {
    return { ok: false, reason: "wrong_key" };
  }
  const keyId = buffer.subarray(keyIdStart, keyIdEnd).toString("utf8");
  if (keyId !== envelope.keyId) {
    return { ok: false, reason: "wrong_key" };
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(envelope.key), buffer.subarray(nonceStart, nonceEnd));
    decipher.setAuthTag(buffer.subarray(tagStart));
    const plaintext = Buffer.concat([decipher.update(buffer.subarray(nonceEnd, tagStart)), decipher.final()]);
    return { ok: true, plaintext: new Uint8Array(plaintext) };
  } catch {
    return { ok: false, reason: "wrong_key" };
  }
}
