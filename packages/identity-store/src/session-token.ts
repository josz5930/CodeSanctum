import { createHash, randomBytes } from "node:crypto";

/**
 * The cookie carries 32 random bytes; only their SHA-256 is stored. A read of
 * `web_session` therefore yields nothing a caller could present. There is no
 * salt because the token is already full-entropy random — a salt would only
 * defend against precomputation, which is not a threat here.
 */
export function sessionHandleFor(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintSessionToken(): { token: string; handle: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, handle: sessionHandleFor(token) };
}
