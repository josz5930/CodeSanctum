const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/u;

export function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Node's base64url decoder is lenient: it accepts padding and standard-base64
 * characters, and silently truncates a trailing partial character. Protocol
 * bytes come off the wire, so anything but exact unpadded base64url is
 * rejected here rather than quietly reinterpreted.
 */
export function decodeBase64Url(text: string): Uint8Array | undefined {
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) return undefined;
  const decoded = new Uint8Array(Buffer.from(text, "base64url"));
  if (encodeBase64Url(decoded) !== text) return undefined;
  return decoded;
}
