// Who may read a published blueprint.
//
// A blueprint link was a bearer capability that worked for anyone, in any tenant, and for people who
// were not signed in, and what it grants includes the gadget's source code. In a deployment with
// tenants (one that signs in through Clerk) a blueprint belongs to the tenant that published it, and
// every read of one by id goes through `readBlueprintFor`, which returns it only to a caller that may
// have it. A refusal returns the same `null` as an id that does not exist, so nothing tells the
// two apart.
//
// Bundled blueprints (installed by the deployment, no `ownerId`) belong to no tenant and stay
// available to everyone, including callers that are not signed in. In a deployment without tenants
// none of this applies and the blueprint is returned as before.

import { blueprintScreenshotUrl, type BlueprintMetadata } from "@gadgets/workshop-shared/api";
import { isClerkEnabled } from "./auth/config.js";
import { readBlueprintKvRecord, type BlueprintKvRecord } from "./storage-schema/blueprints-kv.js";

/** Who is reading: the verified tenant and the Durable Object id of the user. */
export type BlueprintCaller = {
  tenantId: string;
  userDoId: string;
};

/** Whether the deployment keeps blueprints apart by tenant. */
export function isBlueprintIsolation(env: Cloudflare.Env): boolean {
  return isClerkEnabled(env);
}

/** Whether a record is one of the deployment's own bundled blueprints, which no tenant owns. */
export function isBundledBlueprint(record: BlueprintKvRecord): boolean {
  return record.ownerId === undefined;
}

/**
 * Whether `caller` (undefined when not signed in) may read `record`, in a deployment with tenants.
 * Bundled: anyone. Tenant-owned: that tenant. A record that predates tenants and has not yet been
 * attributed (see AdminSettings.ensureBlueprintTenants): only its owner, so that enabling tenants
 * cannot leave an old link open in the meantime.
 */
export function mayReadBlueprint(
    record: BlueprintKvRecord, caller: BlueprintCaller | undefined): boolean {
  if (isBundledBlueprint(record)) return true;
  if (caller === undefined) return false;
  if (record.tenantId !== undefined) return record.tenantId === caller.tenantId;
  return record.ownerId === caller.userDoId;
}

/**
 * The record of blueprint `id`, or null when there is none or `caller` may not read it (the same
 * answer as readBlueprintKvRecord gives for a missing id). Every read of a blueprint by id that a
 * caller can reach goes through here. `onRefused` runs when the blueprint exists and the caller may
 * not read it, for audit logging; it is never visible to the caller.
 */
export async function readBlueprintFor(
    env: Cloudflare.Env, id: string, caller: BlueprintCaller | undefined,
    onRefused?: () => void): Promise<BlueprintKvRecord | null> {
  const record = await readBlueprintKvRecord(env, id);
  if (!record) return null;
  if (!isBlueprintIsolation(env) || mayReadBlueprint(record, caller)) return record;
  onRefused?.();
  return null;
}

/**
 * The screenshot fields of a blueprint view. A tenant's blueprint has no public image URL in a
 * deployment with tenants (an image request carries no sign-in, and a public cache would keep it),
 * so only `hasScreenshot` is set, and the client fetches the bytes with
 * `AuthenticatedApi.getBlueprintScreenshot()`. `isGlobal` is true for a bundled blueprint.
 */
export function blueprintScreenshotFields(
    env: Cloudflare.Env, id: string, metadata: Pick<BlueprintMetadata, "screenshot" | "lastUpdated">,
    isGlobal: boolean): { screenshotUrl?: string; hasScreenshot: boolean } {
  const url = isBlueprintIsolation(env) && !isGlobal ? undefined : blueprintScreenshotUrl(id, metadata);
  return { ...(url === undefined ? {} : { screenshotUrl: url }), hasScreenshot: metadata.screenshot === true };
}
