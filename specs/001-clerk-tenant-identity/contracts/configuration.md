# Contract: Configuration (environment variables and Clerk dashboard)

Auth and tenancy configuration is environment-driven and MUST NOT move into `AdminConfig`
(constitution II). Every variable is optional; Clerk is enabled iff both `CLERK_ISSUER` and
`CLERK_PUBLISHABLE_KEY` are set.

| Variable | Kind | Meaning |
|---|---|---|
| `CLERK_ISSUER` | var | Clerk Frontend API URL, e.g. `https://example.clerk.accounts.dev`. Token `iss` must equal it; JWKS at `<issuer>/.well-known/jwks.json`. |
| `CLERK_PUBLISHABLE_KEY` | var | Public key for the SPA (`pk_...`). Returned in `ServerConfig.clerk`. |
| `CLERK_AUTHORIZED_PARTIES` | var | Comma-separated allowed origins for the token `azp` claim. Default: origin of `PUBLIC_BASE_URL`. If neither is set, all tokens are refused. |
| `CLERK_WEBHOOK_SECRET` | secret | Svix signing secret (`whsec_...`). Unset → the webhook endpoint answers 404. |
| `TENANT_MODE` | var | `single` pins the deployment to one organization. Anything else = shared pool. |
| `TENANT_ID` | var | Clerk organization id for `TENANT_MODE=single`. |
| `ADMINS` | var (existing) | On a Clerk deployment, entries are Clerk user ids (operators). |

## Clerk dashboard setup

1. Enable Organizations (allow personal accounts) and set roles as desired.
2. Session token template (Sessions → Customize session token):
   `{ "name": "{{user.full_name}}", "email": "{{user.primary_email_address}}" }` (optional; used for display).
3. Webhooks → add endpoint `https://<deployment>/api/clerk-webhook`, events
   `organizationMembership.deleted`, `user.deleted` and `organization.deleted`; copy the signing secret to
   `CLERK_WEBHOOK_SECRET`.
4. Add the deployment origin to the allowed origins.
