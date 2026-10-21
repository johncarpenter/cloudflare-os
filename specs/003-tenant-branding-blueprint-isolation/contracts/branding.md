# Contract: tenant branding

## Who

| Actor | Can |
|---|---|
| Organization administrator (verified session role `admin` / `org:admin`) | read, set and clear their own organization's name, logo, accent color |
| Other members | see it; cannot change it |
| Personal workspace user | nothing: shows the deployment's branding |
| Operator (`ADMINS`) | list tenants with branding, clear any, switch the feature off for the deployment |
| Signed-out visitor | sees the deployment's branding only |

## Parts and validation

| Part | Rule | Error text names |
|---|---|---|
| name | trimmed, 1-40 characters (MAX_SITE_NAME_LENGTH), no control characters; shown as text | length / characters |
| logo | PNG signature and header, at most 256 KiB (`MAX_SITE_LOGO_BYTES`), at most 512 px per side | type / size / dimensions |
| accent color | `#rrggbb` | color |

Parts are independent: setting one never changes another; clearing the last part removes the record.

## Display

The authenticated SPA overlays the effective branding on the deployment config:

| Surface | Source |
|---|---|
| name in header, sidebar, titles, onboarding | `siteName` |
| logo in header and sidebar; tab icon | `siteLogo` (inline PNG data URL) |
| brand colors | `accentColor` |
| sign-in and sign-up pages | always the deployment's |

A workspace switch clears the previous overlay before the next one is applied; there is no frame in which
the new workspace shows the old one's identity.

## Limits

Banners and announcements are not branding and stay deployment-wide. No other deployment setting is
reachable through this capability.

## Audit

Every set, clear and operator clear logs `branding.changed` (tenant id, user id, which part, who:
`tenant-admin` or `operator`). Image bytes and names are never logged.
