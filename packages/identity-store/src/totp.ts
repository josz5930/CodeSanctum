import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_MOD = 10 ** TOTP_DIGITS;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const TOTP_SECRET_BYTES = 20;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 6238 TOTP with the RFC's default HMAC-SHA1. SHA-1 is correct here and is
 * not a defect: authenticator apps assume it. Do not "upgrade" the hash.
 */
export function totpCodeAt(secret: Buffer, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  const msg = Buffer.alloc(8);
  // Unsigned 64-bit counter (two's complement for negative steps near t=0).
  msg.writeBigUInt64BE(BigInt.asUintN(64, BigInt(counter)));
  const hmac = createHmac("sha1", secret).update(msg).digest();
  // Dynamic truncation per RFC 4226 §5.4.
  const offset = hmac[19]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % TOTP_MOD).padStart(TOTP_DIGITS, "0");
}

/**
 * Returns the time step (RFC 6238 counter) that the presented code matches,
 * or undefined. The caller must claim the step with
 * `AccountStore.claimTotpStep` before it accepts the code, because RFC 6238
 * section 5.2 forbids a second use of one OTP.
 */
export function matchTotpStep(secret: Buffer, presented: string, unixSeconds: number): number | undefined {
  if (!/^\d{6}$/.test(presented)) {
    return undefined;
  }
  const presentedBuf = Buffer.from(presented, "utf8");
  const currentStep = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  let matched: number | undefined;
  for (const offset of [-1, 0, 1] as const) {
    const expected = totpCodeAt(secret, unixSeconds + offset * TOTP_STEP_SECONDS);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (timingSafeEqual(expectedBuf, presentedBuf)) {
      matched = currentStep + offset;
    }
  }
  return matched;
}

export function verifyTotpCode(secret: Buffer, presented: string, unixSeconds: number): boolean {
  return matchTotpStep(secret, presented, unixSeconds) !== undefined;
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function mintTotpSecret(): { secret: Buffer; base32: string } {
  const secret = randomBytes(TOTP_SECRET_BYTES);
  return { secret, base32: encodeBase32(secret) };
}

export function sealTotpSecret(secret: Buffer, key: Buffer): string {
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1$${iv.toString("hex")}$${tag.toString("hex")}$${ciphertext.toString("hex")}`;
}

export function openTotpSecret(box: string, key: Buffer): Buffer | undefined {
  try {
    const parts = box.split("$");
    if (parts.length !== 4 || parts[0] !== "v1") {
      return undefined;
    }
    const ivHex = parts[1] ?? "";
    const tagHex = parts[2] ?? "";
    const cipherHex = parts[3] ?? "";
    if (!/^[a-f0-9]+$/i.test(ivHex) || !/^[a-f0-9]+$/i.test(tagHex) || !/^[a-f0-9]+$/i.test(cipherHex)) {
      return undefined;
    }
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(cipherHex, "hex");
    if (iv.length !== GCM_IV_LENGTH || tag.length !== GCM_TAG_LENGTH || ciphertext.length === 0) {
      return undefined;
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return undefined;
  }
}
