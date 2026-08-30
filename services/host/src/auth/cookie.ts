export const SESSION_COOKIE_NAME = "__Host-codeattest_session";
export const SESSION_COOKIE_NAME_INSECURE = "codeattest_session_insecure_local";

export type SessionCookieOptions = {
  secure: boolean;
  maxAgeSeconds: number;
};

function cookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_INSECURE;
}

export function serializeSessionCookie(token: string, options: SessionCookieOptions): string {
  const parts = [`${cookieName(options.secure)}=${token}`, "Path=/", "HttpOnly"];
  if (options.secure) {
    parts.push("Secure");
  }
  parts.push("SameSite=Strict", `Max-Age=${options.maxAgeSeconds}`);
  return parts.join("; ");
}

export function readSessionCookie(header: string | undefined, secure: boolean): string | undefined {
  if (header === undefined || header.length === 0) {
    return undefined;
  }
  const expected = cookieName(secure);
  for (const part of header.split(";")) {
    const pair = part.trim();
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator);
    if (name !== expected) {
      continue;
    }
    const value = pair.slice(separator + 1);
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}
