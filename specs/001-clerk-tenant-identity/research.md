# Research: Clerk Sign-In and Tenant Identity

No `NEEDS CLARIFICATION` items remained after the spec clarifications. The questions below were
resolved by reading the repository and Clerk's documented token format.

## R1. How should Clerk plug into authentication?

- **Decision**: Add `PublicApi.authenticateFromClerk(sessionToken)`, parallel to
  `authenticateFromCfAccess()` (`server.ts`).
- **Rationale**: Access is already an "externally authenticated identity → auto-provisioned user
  DO" path with the same shape (verify assertion, derive id, create-on-first-use honouring
  `signupsEnabled`, build `AuthenticatedApiImpl`). Reusing it keeps the kernel diff small.
- **Alternatives**: (a) Exchange the Clerk token for a legacy `userDo:secret` session token via
  `authenticate(token)`. Rejected: the bearer token would outlive Clerk membership, so FR-013 /
  SC-005 could not hold. (b) A new auth gatekeeper (like Google sign-in). Rejected: those flows are
  popup/OAuth-handoff based; Clerk already supplies its own browser UI and session.

## R2. How is the session JWT verified without a Clerk secret key?

- **Decision**: `jose` `jwtVerify` against `createRemoteJWKSet(<issuer>/.well-known/jwks.json)`,
  requiring `iss === CLERK_ISSUER`, valid `exp`/`nbf` (10 s tolerance), and `azp` in the allowed
  origins (`CLERK_AUTHORIZED_PARTIES`, else the origin of `PUBLIC_BASE_URL`; none configured →
  refuse). `sub` is the user id; `sid` the session id.
- **Rationale**: Session tokens are RS256 and the JWKS is public. `jose` is already a dependency
  (used for Access in `access.ts`). `azp` checking is Clerk's CSRF/cross-app guard.
- **Organization claims**: Token v2 carries `o: { id, rol, slg }`; v1 carries `org_id`, `org_role`,
  `org_slug`. Both are read. A token with no organization claim means personal tenant.
- **Profile name**: not in the default token. Read an optional custom `name` claim (configured in the
  Clerk dashboard session-token template, see contracts/configuration.md); fall back to the email
  local-part claim, then to "User". Display only; never used for decisions.

## R3. How is a user addressed, and how is the tenant recovered from an id?

- **Decision**: DO name and `profile.id` = `tenantId + "\0" + clerkUserId`.
  `tenantOfProfileId(id)` = text before the NUL, or `""` when there is none (legacy accounts).
- **Rationale**: In this codebase `profile.id` already equals the user DO name (password: username;
  Access / gatekeeper sign-in: email), and sharing, directory, `#isAdmin` and the overseer all key
  on it. Making the tenant derivable from the id means tenant checks need no extra lookup. The
  design record specifies this exact NUL format.
- **Alternatives**: Opaque `idFromName(random)` with a tenant column. Rejected: every id consumer
  would need a lookup, and the id is already the primary key everywhere.

## R4. Where do tenant checks go (WP3 scope)?

- **Findings**: (1) `AuthenticatedApiImpl.searchUsers` uses one global `UserDirectoryDurableObject`.
  (2) `Overseer.addCollaborator(username)` resolves `idFromName(username)`. (3) Share-link
  redemption and all collaborator access run through `Overseer.open()`. (4) Connected accounts are
  stubs persisted in the (tenant-keyed) user DO, and `GatekeeperVendor.createAccount()` mints a fresh
  account per call, so account storage is tenant-scoped by construction. The only
  deployment-global gatekeeper state is deliberately shared (e.g. public context collections,
  keyed by the binding's static `sharingDomain`).
- **Decision**: Directory becomes one DO per tenant (`getByName(tenantOf(id))`; legacy `""` is the
  existing instance, so no data moves). `addCollaborator` returns `null` (the existing "no such
  user" answer) for a different tenant. `open()` refuses any non-owner whose tenant differs from the
  owner's, which covers share links, direct adds and transitive edges.
- **Not changed**: per-tenant `sharingDomain` for the context gatekeeper. Its value comes from a
  static service-binding prop and it only scopes admin-managed public collections, which are shared
  across a deployment on purpose; private collections are owned by the per-user account id. Public
  collection tenancy belongs to the data-catalog spec.

## R5. How is "membership removed" enforced within 60 s (SC-005)?

- **Decision**: (1) The client renews the server session every 30 s with a fresh Clerk token
  (`renewSession`). (2) The server compares user and tenant to the original session and refuses
  (and aborts the session) on any change or lapse; a missing renewal for 75 s aborts it. (3) The
  `#user` stub getter asserts liveness, so a stalled client cannot keep using the API past the
  deadline. (4) The `organizationMembership.deleted` webhook records `membershipEndedAt` on the
  user DO, so a renewal whose token was issued earlier is refused immediately.
- **Rationale**: Clerk tokens live 60 s and are issued from current membership, so a removed member
  cannot obtain an org-scoped token after removal. The webhook closes the remaining window.
- **Alternatives**: Calling the Clerk backend API on every request. Rejected: needs a secret key,
  adds latency, couples availability to Clerk.

## R6. Webhook verification

- **Decision**: Implement Svix signature verification with WebCrypto (`svix-id`, `svix-timestamp`,
  `svix-signature`; HMAC-SHA256 over `id.timestamp.body` using the base64 part of `whsec_...`;
  5 minute tolerance; constant-time compare). No `svix` dependency.
- **Events**: `organizationMembership.deleted` → end membership + revoke credentials;
  `user.deleted` → erase personal tenant + end every recorded org membership.

## R7. Single-tenant (dedicated) mode

- **Decision**: `TENANT_MODE=single` with `TENANT_ID=<org id>`. Effective only when Clerk is
  enabled. Any session whose resolved tenant differs, including personal, is refused and nothing is
  created. Misconfiguration (single without `TENANT_ID`) refuses everything (fail closed).

## R8. Operators and the admin panel

- **Decision**: `ADMINS` entries are matched against the Clerk user id part of the user key.
  Clerk organization roles never grant admin. `ADMINS` stays env-driven (constitution II).

## R9. Remembering the last-used workspace across devices (FR-006a)

- **Decision**: Store `lastWorkspace` in the user's personal-tenant DO (deterministic name, always
  addressable). `rememberWorkspace()` writes the verified current tenant; `getWorkspaceInfo()` returns
  it. The SPA, once per browser session, switches Clerk's active organization to it before
  remembering anything, falling back silently to personal when the membership is gone.
- **Alternatives**: New registry DO keyed by Clerk user id. Rejected: a new class and migration for
  one string.

## R10. Other sign-in methods on a Clerk deployment

- **Decision**: With Clerk enabled, password login/signup, `authenticate(token)`, gatekeeper sign-in
  and device-session handoff are refused (spec assumption). Native-app device handoff on a Clerk
  deployment is out of scope and refuses explicitly rather than minting an unusable credential.

## R11. Frontend

- **Decision**: `@clerk/clerk-react` inside `ClerkAppProvider`, rendered only when
  `ServerConfig.clerk` is present. The publishable key is delivered at runtime by `getServerConfig()`
  (no build-time variable, so one asset build serves every deployment). Clerk's prebuilt `SignIn`,
  `SignUp`, `OrganizationSwitcher` and `UserProfile` modal cover FR-001, FR-011, FR-012, FR-019 and
  FR-020 (create org, invite, member roles/removal, switch, profile/security, sign-out).
