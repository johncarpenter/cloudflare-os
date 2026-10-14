# Contract: `POST /api/clerk-webhook`

Routed to the backend by the existing router `/api/*` rule; no router change.

**Authentication**: Svix headers `svix-id`, `svix-timestamp` (±5 min), `svix-signature`
(`v1,<base64 HMAC-SHA256(secret, "<id>.<timestamp>.<raw body>")>`, space-separated list accepted),
secret = base64 part of `CLERK_WEBHOOK_SECRET`. Any failure → `401`, no body processing.

**Responses**: `404` when `CLERK_WEBHOOK_SECRET` or Clerk is not configured; `405` for non-POST;
`401` bad signature; `204` handled or ignored event; `500` handler failure (so Svix retries).

| Event | Payload fields used | Effect |
|---|---|---|
| `organizationMembership.deleted` | `data.organization.id`, `data.public_user_data.user_id` | On user key `org NUL user`: `membershipEndedAt = now`, revoke connected accounts. Content retained. |
| `user.deleted` | `data.id` | Personal DO: revoke accounts, end memberships for every `knownTenants` entry, delete all storage. |

Handlers are idempotent. Audit events: `clerk.membership.ended`, `clerk.account.erased`
(tenant and user ids only).
