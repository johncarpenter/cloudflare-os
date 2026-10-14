# Clerk sign-in and tenants

A deployment can use [Clerk](https://clerk.com) for sign-in, users and organizations. It is off
unless configured, and a deployment without it behaves exactly as before. Design record:
`docs/specs/Cloudflare OS SaaS — Design & Handoff.md`; requirements and plan:
`specs/001-clerk-tenant-identity/`.

## Model

- A **tenant** is the unit of isolation: the user's active Clerk organization, or, with none, a
  personal tenant (`u_<clerkUserId>`). Everything a user owns (workspaces, chats, connected-account
  stubs) lives in a user Durable Object addressed by `tenantId NUL clerkUserId`, which is also the
  user's profile id. The same person in two tenants therefore has two independent workspaces, and an
  email address never identifies anyone.
- `src/tenant.ts` is the one seam: `tenantOfProfileId`, `sameTenant`, `resolveTenant`. Legacy accounts
  (password, Cloudflare Access, gatekeeper sign-in) have ids without a NUL and all belong to the
  tenant `""`.
- Tenant checks sit at the existing choke points: the user directory is one Durable Object per tenant,
  `Overseer.addCollaborator` answers another tenant's user as "no such user", and `Overseer.open`
  refuses any non-owner outside the owner's tenant (this covers direct grants, share links and chains
  of grants).
- The tenant always comes from the verified session token, never from an argument.

## Sign-in flow

1. The SPA reads `ServerConfig.clerk.publishableKey` and starts Clerk (`src/clerk/`).
2. Once signed in, it calls `PublicApi.authenticateFromClerk(token)`. The backend verifies the token
   against the issuer's JWKS (`iss`, `exp`, and `azp` against the allowed origins), resolves the
   tenant, creates the user on first use (honouring the admin "signups" switch), and returns an
   `AuthenticatedApi`.
3. The SPA calls `renewSession(token)` every 30 seconds with a freshly fetched token. The backend
   refuses calls and closes the connection 75 seconds after the last renewal, or at once if the
   renewal names another user or tenant. Because Clerk tokens are issued from current membership, a
   removed member loses access within about a minute.
4. Changing the active organization re-authenticates into the new tenant; the previous workspace is
   dropped from the screen first.

While Clerk is enabled, password login and signup, `authenticate(token)`, gatekeeper sign-in and the
native-app device handoff are refused. Do not combine Clerk with `CF_ACCESS_AUD`.

## Configuration

All environment-driven; none of it is in `AdminConfig`, so an admin session cannot change it.

| Variable | Meaning |
|---|---|
| `CLERK_ISSUER` | Clerk Frontend API URL, for example `https://example.clerk.accounts.dev`. |
| `CLERK_PUBLISHABLE_KEY` | `pk_...`, delivered to the browser. Clerk is enabled iff this and `CLERK_ISSUER` are set. |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated allowed `azp` origins. Default: the origin of `PUBLIC_BASE_URL`. With neither, every token is refused. |
| `CLERK_WEBHOOK_SECRET` | Svix signing secret (`whsec_...`). Unset: the webhook answers 404. |
| `TENANT_MODE=single`, `TENANT_ID` | Pin the deployment to one organization (a dedicated deployment). Others, including users with no organization, are refused. A missing `TENANT_ID` refuses everyone. |
| `ADMINS` | Deployment operators, as Clerk user ids. An organization role never grants admin. |

Clerk dashboard:

1. Enable Organizations, with personal accounts allowed.
2. Customize the session token: `{ "name": "{{user.full_name}}", "email": "{{user.primary_email_address}}" }`
   (optional; display only, never used for decisions).
3. Add a webhook endpoint `https://<deployment>/api/clerk-webhook` for `organizationMembership.deleted`
   and `user.deleted`.

## Lifecycle

- **Membership removed** (webhook): the user's record in that organization refuses sessions issued
  before the removal and revokes their connected accounts. Their workspaces stay in the organization.
  Organization-admin view and reassignment of that content is not built yet.
- **Account deleted** (webhook): the personal tenant is erased (credentials revoked, owned workspaces
  deleted, directory entry removed, storage dropped) and every organization membership is ended.
- **Last-used workspace**: remembered per account in the personal-tenant record and restored once per
  browser session.

Webhook failures return 500 so Svix retries; every step is idempotent.
