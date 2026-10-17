import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  hashSecret,
  matchTotpStep,
  mintSessionToken,
  openTotpSecret,
  SESSION_ABSOLUTE_LIFETIME_MS,
  sessionHandleFor,
  verifySecret,
  type AccountStore,
  type LoginThrottle,
  type SecondFactorState,
  type SessionStore
} from "../../../../packages/identity-store/src/index.js";
import { readSessionCookie, serializeSessionCookie } from "../auth/cookie.js";
import { clientNetworkKey } from "../client-network.js";
import type { ErrorEnvelopeBody } from "../error-envelope.js";

const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_ABSOLUTE_LIFETIME_MS / 1000;
const DUMMY_SECRET_HASH = hashSecret("codeattest-unused-dummy-password");

export type AuthRouteDeps = {
  accounts: AccountStore;
  sessions: SessionStore;
  throttle: LoginThrottle;
  totpKey: Buffer;
  sessionCookieSecure: boolean;
  errorEnvelope: (reasonCode: string) => ErrorEnvelopeBody;
  now?: () => Date;
};

function clock(deps: AuthRouteDeps): Date {
  return deps.now === undefined ? new Date() : deps.now();
}

/**
 * The login throttle counts failures per identifier AND per client network.
 * With the identifier alone, anyone who knows a username could keep that
 * account locked for good by sending a few wrong passwords every window. A
 * client that guesses wrong locks that identifier only for its own network; the
 * account owner on another network can still sign in. Each network still gets
 * only LOGIN_LOCKOUT_THRESHOLD wrong tries per identifier per window.
 */
function throttleKeyFor(identifier: string, request: FastifyRequest): string {
  return createHash("sha256")
    .update(identifier, "utf8")
    .update("\0", "utf8")
    .update(clientNetworkKey(request.ip), "utf8")
    .digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isLoginBody(body: unknown): body is { identifier: string; secret: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  const record = body as Record<string, unknown>;
  return isNonEmptyString(record.identifier) && isNonEmptyString(record.secret);
}

function isSecondFactorBody(body: unknown): body is { code: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  return typeof (body as Record<string, unknown>).code === "string";
}

function presentedToken(request: FastifyRequest, secure: boolean): string | undefined {
  const header = request.headers.cookie;
  return readSessionCookie(typeof header === "string" ? header : undefined, secure);
}

function requestInvalid(deps: AuthRouteDeps, reply: FastifyReply) {
  return reply.code(400).send(deps.errorEnvelope("auth_request_invalid"));
}

function credentialsInvalid(deps: AuthRouteDeps, reply: FastifyReply) {
  return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
}

async function attachSessionCookie(
  deps: AuthRouteDeps,
  reply: FastifyReply,
  input: { accountId: string; secondFactorState: SecondFactorState; now: Date }
): Promise<void> {
  const minted = mintSessionToken();
  await deps.sessions.issue({
    session_handle: minted.handle,
    account_id: input.accountId,
    issued_at: input.now,
    absolute_expires_at: new Date(input.now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS),
    second_factor_state: input.secondFactorState
  });
  reply.header(
    "set-cookie",
    serializeSessionCookie(minted.token, {
      secure: deps.sessionCookieSecure,
      maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS
    })
  );
}

function clearSessionCookie(deps: AuthRouteDeps, reply: FastifyReply): void {
  reply.header(
    "set-cookie",
    serializeSessionCookie("", {
      secure: deps.sessionCookieSecure,
      maxAgeSeconds: 0
    })
  );
}

export async function registerAuthRoutes(server: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  server.post("/v0/auth/login", async (request, reply) => {
    if (!isLoginBody(request.body)) {
      return requestInvalid(deps, reply);
    }
    const identifier = request.body.identifier.toLowerCase();
    const throttleKey = throttleKeyFor(identifier, request);
    const now = clock(deps);

    if ((await deps.throttle.state(throttleKey, now)) === "locked") {
      await deps.throttle.record(throttleKey, "failed");
      return credentialsInvalid(deps, reply);
    }

    const account = await deps.accounts.findByIdentifier(identifier);
    const secretOk = verifySecret(account?.secret_hash ?? DUMMY_SECRET_HASH, request.body.secret);
    if (account === undefined || !secretOk) {
      await deps.throttle.record(throttleKey, "failed");
      return credentialsInvalid(deps, reply);
    }

    await deps.throttle.record(throttleKey, "succeeded");
    const totpEnrolled = account.totp_secret_box !== null;
    await attachSessionCookie(deps, reply, {
      accountId: account.account_id,
      secondFactorState: totpEnrolled ? "pending" : "not_required",
      now
    });
    if (totpEnrolled) {
      return reply.code(202).send({ second_factor_required: true });
    }
    return reply.code(204).send();
  });

  server.post("/v0/auth/login/second-factor", async (request, reply) => {
    if (!isSecondFactorBody(request.body)) {
      return requestInvalid(deps, reply);
    }
    const token = presentedToken(request, deps.sessionCookieSecure);
    if (token === undefined) {
      return credentialsInvalid(deps, reply);
    }
    const now = clock(deps);
    const pending = await deps.sessions.resolve(sessionHandleFor(token), now);
    if (pending === undefined || pending.second_factor_state !== "pending") {
      return credentialsInvalid(deps, reply);
    }
    const account = await deps.accounts.findById(pending.account_id);
    if (account === undefined || account.totp_secret_box === null) {
      return credentialsInvalid(deps, reply);
    }
    const throttleKey = throttleKeyFor(account.identifier, request);
    if ((await deps.throttle.state(throttleKey, now)) === "locked") {
      await deps.throttle.record(throttleKey, "failed");
      return credentialsInvalid(deps, reply);
    }
    const secret = openTotpSecret(account.totp_secret_box, deps.totpKey);
    const unixSeconds = Math.floor(now.getTime() / 1000);
    const step = secret === undefined ? undefined : matchTotpStep(secret, request.body.code, unixSeconds);
    // A replayed code gets the same answer as a wrong code, so a caller cannot
    // learn which codes were valid.
    const codeOk = step !== undefined && (await deps.accounts.claimTotpStep(account.account_id, step)) === "claimed";
    if (!codeOk) {
      await deps.throttle.record(throttleKey, "failed");
      return credentialsInvalid(deps, reply);
    }

    await deps.throttle.record(throttleKey, "succeeded");
    await attachSessionCookie(deps, reply, {
      accountId: account.account_id,
      secondFactorState: "satisfied",
      now
    });
    await deps.sessions.revoke(pending.session_handle, "rotated");
    return reply.code(204).send();
  });

  server.post("/v0/auth/logout", async (request, reply) => {
    const token = presentedToken(request, deps.sessionCookieSecure);
    if (token !== undefined) {
      await deps.sessions.revoke(sessionHandleFor(token), "logout");
    }
    clearSessionCookie(deps, reply);
    return reply.code(204).send();
  });

  server.get("/v0/auth/session", async (request, reply) => {
    const token = presentedToken(request, deps.sessionCookieSecure);
    if (token === undefined) {
      return credentialsInvalid(deps, reply);
    }
    const now = clock(deps);
    const session = await deps.sessions.resolve(sessionHandleFor(token), now);
    if (
      session === undefined ||
      (session.second_factor_state !== "not_required" && session.second_factor_state !== "satisfied")
    ) {
      return credentialsInvalid(deps, reply);
    }
    const account = await deps.accounts.findById(session.account_id);
    if (account === undefined) {
      return credentialsInvalid(deps, reply);
    }
    const grants = await deps.accounts.grantsFor(account.account_id);
    await deps.sessions.touch(session.session_handle, now);
    const roles: Array<(typeof grants)[number]["role"]> = [];
    for (const grant of grants) {
      if (!roles.includes(grant.role)) {
        roles.push(grant.role);
      }
    }
    return reply.code(200).send({
      account_id: account.account_id,
      tenant_id: account.tenant_id,
      roles
    });
  });
}
