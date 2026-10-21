// Per-organization branding: its validation, the view members get, and the capability an
// organization administrator manages it through. The branding itself is stored by the
// organization's UserDirectoryDurableObject, which also enforces the same validation.

import { RpcTarget } from "capnweb";
import { validateRpc } from "capnweb-validate";
import {
  MAX_SITE_NAME_LENGTH, isHexColor,
  type EffectiveBranding, type TenantAdminApi, type TenantBranding,
} from "@gadgets/workshop-shared/api";
import { createWorkshopLogger } from "./observability";
import { validateSiteLogo } from "./site-logo.js";
import type { UserDirectoryDurableObject } from "./user-directory.js";

const logger = createWorkshopLogger("workshop.tenant.branding");

/** The tenant branding that is set, as stored. Absent parts fall back to the deployment's. */
export type StoredBranding = TenantBranding;

/** Whether any part of `branding` is set. */
export function hasBranding(branding: StoredBranding): boolean {
  return branding.name !== undefined || branding.logo !== undefined ||
      branding.accentColor !== undefined;
}

/** The trimmed name; throws unless it is non-blank, within MAX_SITE_NAME_LENGTH, and printable. */
export function validateBrandingName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("Name must not be blank.");
  if (trimmed.length > MAX_SITE_NAME_LENGTH) {
    throw new Error(`Name too long (max ${MAX_SITE_NAME_LENGTH} characters).`);
  }
  if (/\p{Cc}/u.test(trimmed)) throw new Error("Name must not contain control characters.");
  return trimmed;
}

/** Throws unless `color` is a hex color. */
export function validateBrandingColor(color: string): void {
  if (!isHexColor(color)) throw new Error("Accent color must be a hex color such as #3b82f6.");
}

/** Throws unless `png` is a PNG within the deployment logo's limits. */
export function validateBrandingLogo(png: Uint8Array): void {
  validateSiteLogo(png);
}

// Chunked so a 256 KiB logo does not spread that many arguments into one call.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/**
 * What members see for the branding `stored`: null when nothing is set. The logo is an inline PNG
 * data URL, because the Workshop serves no per-organization image URL (a request for an image
 * carries no sign-in).
 */
export function effectiveBranding(stored: StoredBranding): EffectiveBranding | null {
  if (!hasBranding(stored)) return null;
  return {
    ...(stored.name !== undefined && { siteName: stored.name }),
    ...(stored.logo !== undefined && {
      siteLogo: { url: `data:image/png;base64,${toBase64(stored.logo)}` },
    }),
    ...(stored.accentColor !== undefined && { accentColor: stored.accentColor }),
  };
}

/**
 * The capability to manage one organization's branding. `assertAllowed` runs before every method
 * and throws unless the session is still live, still holds the administrator role, and the
 * deployment still offers organization branding.
 */
@validateRpc()
export class TenantAdminApiImpl extends RpcTarget implements TenantAdminApi {
  constructor(
      private directory: DurableObjectStub<UserDirectoryDurableObject>,
      private tenantId: string, private userId: string,
      private assertAllowed: () => Promise<void>) {
    super();
  }

  async getBranding(): Promise<TenantBranding> {
    await this.assertAllowed();
    return await this.directory.getBranding();
  }

  async setIdentity(update: { name?: string | null; accentColor?: string | null }): Promise<void> {
    await this.assertAllowed();
    await this.directory.updateIdentity(update);
    this.#audit("identity");
  }

  async setLogo(png: Uint8Array | null): Promise<void> {
    await this.assertAllowed();
    await this.directory.updateLogo(png);
    this.#audit("logo");
  }

  // Ids only: the name and the image are the organization's, not the log's.
  #audit(part: "identity" | "logo"): void {
    logger.info("organization branding changed", {
      event: "branding.changed", tenantId: this.tenantId, userId: this.userId, operation: part,
    });
  }
}
