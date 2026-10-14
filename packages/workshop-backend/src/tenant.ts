// The TenantContext seam: every tenant decision in the backend goes through this module.
//
// A tenant is the unit of isolation: a Clerk organization, or a user's personal tenant. A user's
// Durable Object is addressed by `tenantId NUL userId`, and that string is also the user's profile
// id, so any profile id alone says which tenant its owner belongs to. Accounts that predate tenants
// (password, Cloudflare Access and gatekeeper sign-in) have ids without a NUL; they all belong to
// the one legacy tenant, "", which keeps their behaviour unchanged.

/** Separates the tenant from the user in a user key. Never appears in Clerk ids. */
const SEP = "\u0000";

/** What kind of workspace a tenant is. */
export type TenantKind = "organization" | "personal";

/** The tenant a verified request acts in, resolved from a verified Clerk session. */
export type TenantContext = {
  tenantId: string;
  kind: TenantKind;
  /** The permanent Clerk user id. */
  userId: string;
  /** The Clerk organization role from the token. Informational: it never grants admin. */
  orgRole?: string;
  /** `tenantId NUL userId`: the user Durable Object name and profile id. */
  userKey: string;
};

/** Why a verified session was not given a tenant. */
export type TenantRefusal = "wrong-tenant" | "misconfigured";

/** Environment variables that pin a deployment to one tenant. */
export type TenantEnv = Readonly<{ TENANT_MODE?: string; TENANT_ID?: string }>;

/** The tenant id of `userId`'s personal workspace. */
export function personalTenantId(userId: string): string {
  return `u_${userId}`;
}

/** Builds the user key. Throws if either part contains the separator. */
export function makeUserKey(tenantId: string, userId: string): string {
  if (tenantId.includes(SEP) || userId.includes(SEP) || tenantId === "" || userId === "") {
    throw new Error("Invalid tenant or user id.");
  }
  return `${tenantId}${SEP}${userId}`;
}

/** The tenant a profile id belongs to: `""` for legacy (non-tenant) accounts. */
export function tenantOfProfileId(profileId: string): string {
  const at = profileId.indexOf(SEP);
  return at < 0 ? "" : profileId.slice(0, at);
}

/** The Clerk user id part of a profile id; legacy ids are returned unchanged. */
export function userIdOfProfileId(profileId: string): string {
  const at = profileId.indexOf(SEP);
  return at < 0 ? profileId : profileId.slice(at + 1);
}

/** Whether two profile ids belong to the same tenant. */
export function sameTenant(a: string, b: string): boolean {
  return tenantOfProfileId(a) === tenantOfProfileId(b);
}

/**
 * Whether the deployment is pinned to one organization (`TENANT_MODE=single`). Callers must only
 * consult it on a Clerk-enabled deployment; legacy sign-in has no tenants to pin.
 */
export function isSingleTenant(env: TenantEnv): boolean {
  return env.TENANT_MODE === "single";
}

/**
 * Resolves the tenant for a verified Clerk session. In the shared pool the active organization is
 * the tenant and a user with none gets a personal tenant. A single-tenant deployment accepts only
 * its own organization, and fails closed when `TENANT_ID` is missing.
 */
export function resolveTenant(
    env: TenantEnv,
    claims: { userId: string; orgId?: string; orgRole?: string },
): { ok: true; tenant: TenantContext } | { ok: false; reason: TenantRefusal } {
  if (isSingleTenant(env)) {
    if (!env.TENANT_ID) return { ok: false, reason: "misconfigured" };
    if (claims.orgId !== env.TENANT_ID) return { ok: false, reason: "wrong-tenant" };
  }
  const tenantId = claims.orgId ?? personalTenantId(claims.userId);
  return {
    ok: true,
    tenant: {
      tenantId,
      kind: claims.orgId ? "organization" : "personal",
      userId: claims.userId,
      orgRole: claims.orgRole,
      userKey: makeUserKey(tenantId, claims.userId),
    },
  };
}
