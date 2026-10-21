# Data Model: Tenant Branding and Blueprint Isolation

## Blueprint record (`BLUEPRINTS` KV, existing) — one field added

| Field | Rule |
|---|---|
| `metadata`, `ownerId`, `gadgetId` | unchanged |
| `tenantId?` | The publisher's tenant, written when a blueprint is published or imported (`tenantOfProfileId(profile.id)`). Absent on records that predate the feature and on bundled blueprints. `""` is the legacy tenant. |

**Classification** (used by `blueprint-access.ts`):

| `ownerId` | `tenantId` | Class | Readable by |
|---|---|---|---|
| absent | absent | bundled (global) | any signed-in user; unauthenticated callers too |
| present | present | tenant-owned | callers whose tenant equals `tenantId` |
| present | absent | unattributed | only the owner, until the backfill sweep sets `tenantId` |

In a deployment without Clerk the classification is not consulted (behaviour unchanged).

## Tenant branding (per-tenant Durable Object, new table)

`UserDirectoryDurableObject` named by the tenant id gets one more table:

| Column | Type | Rule |
|---|---|---|
| `id` | integer, always 1 | single row |
| `name` | text, nullable | trimmed, 1-40 chars (MAX_SITE_NAME_LENGTH), no control characters |
| `logo` | blob, nullable | PNG, at most 256 KiB, at most 512 px per side |
| `accent_color` | text, nullable | `#rrggbb` |
| `updated_at` | integer | epoch ms of the last change |
| `updated_by` | text | the editing user's profile id (display/audit only, never authority) |

A null column means "fall back to the deployment's". A row with all three null is deleted.
`eraseTenant` (spec 001) deletes the row with the rest of the tenant.

## Effective branding (computed, not stored)

`{ siteName?, siteLogo?: { url: "data:image/png;base64,..." }, accentColor? }` — only the parts that
are set. The SPA merges it over the deployment `ServerConfig`; an absent part keeps the deployment's.

## Tenant branding index (`AdminSettings` Durable Object, new table)

| Column | Rule |
|---|---|
| `tenant_id` | primary key |
| `updated_at` | epoch ms |

Written by the save and clear paths so operators can list tenants with branding. It is an index of
what exists, not a source of truth: the tenant Durable Object is.

## Admin config (existing, one field added)

`tenantBrandingEnabled: boolean`, default `true`. When false, `getBranding` returns null and
`getTenantAdminApi` returns null; nothing saved is deleted.

## Session role (in memory, per connection)

`TenantContext.orgRole` is refreshed at every `renewSession`; `isOrganizationAdmin(orgRole)` is true
for `admin` (token v2) and `org:admin` (token v1), and never for a personal tenant.

## State transitions

```text
branding: none --admin sets part--> partial/complete --admin clears part--> partial --clears last--> none (row deleted)
          any --operator clears--> none     any --organization deleted--> erased
          any --tenantBrandingEnabled=false--> hidden (kept)     --true--> shown again

blueprint: published/imported --> tenant-owned (tenantId set)
           legacy (no tenantId, has owner) --sweep--> tenant-owned
           tenant-owned --featured / promoted--> refused (stays tenant-owned)
```
