# Data Model: Clerk Sign-In and Tenant Identity

## TenantContext (per request, not persisted)

| Field | Type | Rule |
|---|---|---|
| `tenantId` | string | Clerk organization id (`org_...`) for an organization; `u_<clerkUserId>` for a personal tenant. `""` only for legacy (non-Clerk) accounts. |
| `kind` | `"organization" \| "personal"` | `organization` iff the verified token carries an active organization. |
| `userId` | string | Clerk `sub`. Permanent. Never an email. |
| `orgRole` | string \| undefined | Clerk organization role from the token; informational (not authority for admin). |
| `userKey` | string | `tenantId + "\0" + userId`. Equals the user Durable Object name and `AiChatAuthorInfo.id`. |

Derived helpers (`tenant.ts`): `tenantOfProfileId(id)`, `userIdOfProfileId(id)`, `sameTenant(a, b)`,
`personalTenantId(userId)`, `resolveTenant(env, claims)`.

**Validation**: `tenantId` and `userId` MUST NOT contain NUL. In single-tenant mode `resolveTenant`
returns a refusal unless `tenantId === TENANT_ID`.

## ClerkClaims (verified token, not persisted)

`userId`, `sessionId`, `orgId?`, `orgRole?`, `issuedAt`, `expiresAt` (ms), `name?`, `email?`.

## User Durable Object additions (`UserStorage`)

| Field | Type | Purpose |
|---|---|---|
| `membershipEndedAt` | number \| undefined | Set by the `organizationMembership.deleted` webhook. A session whose token `iat` is at or before it is refused. Cleared implicitly when a later token is issued (re-added member). |
| `lastWorkspace` | string \| undefined | Personal-tenant DO only: the tenant last remembered by this user (FR-006a). |
| `knownTenants` | string[] | Personal-tenant DO only: organization tenant ids this user has signed in to; used to end memberships on account deletion. |

Existing `created`, `profile`, `profileRev`, `sessions` are reused. For a Clerk user `profile` is
`{ type: "user", id: userKey, name: <display name> }`; `name` is refreshed from the token claim on
authenticate (bumping `profileRev` so the directory resyncs).

## UserDirectoryDurableObject

One instance per tenant, named by `tenantOfProfileId(profile.id)`. The legacy instance (`""`) is the
existing one, so no data migrates. Search never crosses tenants.

## State transitions

```text
(no DO) --first valid sign-in, signups enabled--> created
created --webhook membership.deleted--> membershipEndedAt = t
   t-or-earlier token --> refused ; later token --> allowed (re-added member)
personal DO --webhook user.deleted--> erased (all storage deleted, credentials revoked first)
org user DO --webhook membership.deleted--> membershipEndedAt = t, credentials revoked, content kept
org user DO --webhook organization.deleted--> erased (workspaces, blueprints, credentials, storage), membershipEndedAt = t kept as a tombstone
```

## Session liveness (in-memory, per RPC connection)

`AuthenticatedApiImpl` holds `{ userKey, tenantId, deadline }`. `renewSession` verifies the new token,
requires identical `userKey`, and moves `deadline` to now + 75 s. Past `deadline`, the `#user`
getter throws `AUTH_ERROR_CODES.sessionExpired`; a timer aborts the connection.
