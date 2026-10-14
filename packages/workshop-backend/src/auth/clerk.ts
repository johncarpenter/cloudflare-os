// Verification of Clerk session tokens. Clerk signs them with a key published at the issuer's JWKS
// endpoint, so no Clerk secret is needed to check one.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/** Environment needed to verify a Clerk session token. */
export type ClerkEnv = Readonly<{
  CLERK_ISSUER?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  PUBLIC_BASE_URL?: string;
}>;

/** The facts about a Clerk session that the backend relies on, from a verified token. */
export type ClerkClaims = {
  userId: string;
  sessionId?: string;
  /** Active organization, if any. */
  orgId?: string;
  orgRole?: string;
  /** Token issue and expiry times, epoch milliseconds. */
  issuedAt: number;
  expiresAt: number;
  /** Display-only values from optional custom session claims. Never used for decisions. */
  name?: string;
  email?: string;
};

type TokenVerifier = (token: string, env: ClerkEnv) => Promise<JWTPayload>;

const remoteJwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * The origins allowed in the token's `azp` claim: `CLERK_AUTHORIZED_PARTIES`, else the origin of
 * `PUBLIC_BASE_URL`. Empty means no token can be accepted.
 */
export function authorizedParties(env: ClerkEnv): string[] {
  if (env.CLERK_AUTHORIZED_PARTIES) {
    return env.CLERK_AUTHORIZED_PARTIES.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (env.PUBLIC_BASE_URL) {
    try {
      return [new URL(env.PUBLIC_BASE_URL).origin];
    } catch {
      return [];
    }
  }
  return [];
}

async function verifySignature(token: string, env: ClerkEnv): Promise<JWTPayload> {
  const issuer = env.CLERK_ISSUER;
  if (!issuer) throw new Error("Clerk issuer is not configured.");
  let jwks = remoteJwkSets.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`));
    remoteJwkSets.set(issuer, jwks);
  }
  return (await jwtVerify(token, jwks, {
    issuer,
    algorithms: ["RS256"],
    clockTolerance: 10,
    requiredClaims: ["sub", "exp", "iat"],
  })).payload;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Returns the claims of a Clerk session token, or null when the token cannot be trusted: bad
 * signature, wrong issuer, expired, or issued to an origin this deployment does not serve (`azp`).
 * Fails closed when no allowed origin is configured.
 */
export async function verifyClerkSessionToken(
    token: string, env: ClerkEnv,
    verifier: TokenVerifier = verifySignature): Promise<ClerkClaims | null> {
  let payload: JWTPayload;
  try {
    payload = await verifier(token, env);
  } catch {
    return null;
  }

  const azp = optionalString(payload.azp);
  if (!azp || !authorizedParties(env).includes(azp)) return null;

  const userId = optionalString(payload.sub);
  if (!userId || payload.exp === undefined || payload.iat === undefined) return null;

  // Token version 2 nests the active organization under `o`; version 1 uses flat `org_*` claims.
  const org = typeof payload.o === "object" && payload.o !== null
      ? payload.o as Record<string, unknown> : undefined;
  return {
    userId,
    sessionId: optionalString(payload.sid),
    orgId: optionalString(org?.id) ?? optionalString(payload.org_id),
    orgRole: optionalString(org?.rol) ?? optionalString(payload.org_role),
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
    name: optionalString(payload.name),
    email: optionalString(payload.email),
  };
}
