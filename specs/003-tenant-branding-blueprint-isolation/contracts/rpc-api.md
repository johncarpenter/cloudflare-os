# Contract: Workshop RPC additions (`packages/workshop-shared/src/api.ts`)

Every addition is doc-commented in source (constitution I).

```ts
// ---- types
/** An organization's branding as stored. Every part is optional; absent parts fall back to the deployment's. */
type TenantBranding = { name?: string; logo?: Uint8Array; accentColor?: string; updatedAt?: Date };

/** The branding the active workspace shows. Only the parts that are set. */
type EffectiveBranding = { siteName?: string; siteLogo?: AvatarImage; accentColor?: string };

/** One row of the operator's list. */
type TenantBrandingSummary = { tenantId: string; updatedAt: Date };

// BlueprintPublicInfo / BlueprintUserSummary
hasScreenshot: boolean;     // true when an image exists; screenshotUrl is present only for bundled blueprints

// AdminConfig / AdminConfigView
tenantBrandingEnabled: boolean;

// ---- AuthenticatedApi
/** The active workspace's effective branding, or null for personal workspaces, tenants with none,
 *  and deployments with per-tenant branding off. */
getBranding(): Promise<EffectiveBranding | null>;

/** A capability to manage the active organization's branding, or null unless the verified session
 *  holds the administrator role in an organization with per-tenant branding on. */
getTenantAdminApi(): Promise<RpcStub<TenantAdminApi> | null>;

/** Like PublicApi.getBlueprint, for a signed-in caller: also finds the caller's tenant's blueprints. */
getBlueprint(id: string): Promise<BlueprintPublicInfo | null>;
downloadBlueprint(id: string): Promise<ReadableStream<Uint8Array>>;

/** The preview image of a blueprint the caller may read (PNG or JPEG bytes), or null. */
getBlueprintScreenshot(id: string): Promise<{ bytes: Uint8Array; contentType: "image/png" | "image/jpeg" } | null>;

// ---- TenantAdminApi (every method re-checks the administrator role)
getBranding(): Promise<TenantBranding>;
/** Sets or clears (null) the name and the accent color; an omitted field is left alone. */
setIdentity(update: { name?: string | null; accentColor?: string | null }): Promise<void>;
/** Sets the logo (PNG) or clears it (null). */
setLogo(png: Uint8Array | null): Promise<void>;

// ---- AdminApi (operators)
listTenantBranding(): Promise<TenantBrandingSummary[]>;
clearTenantBranding(tenantId: string): Promise<void>;
```

## Behavioural guarantees

- `getTenantAdminApi`, `TenantAdminApi.*` and `getBranding` derive the tenant from the verified
  session; no argument names a tenant.
- A refused write changes nothing and names what is wrong (length, type, size, dimensions, color).
- `setIdentity`/`setLogo` never touch another tenant, the deployment branding, or any other setting.
- The role is refreshed at every `renewSession`; a method called after the role was removed fails with
  the coded `sessionNotPermitted` error.
- `PublicApi.getBlueprint` / `downloadBlueprint` keep their signatures and now return null / fail for
  non-bundled blueprints in a Clerk deployment.
- Deployments without Clerk: `getBranding` and `getTenantAdminApi` return null; blueprint calls behave
  as before.
