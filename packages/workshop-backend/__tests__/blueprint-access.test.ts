import { describe, expect, it } from "vitest";
import {
  blueprintScreenshotFields, isBundledBlueprint, mayReadBlueprint, readBlueprintFor,
  type BlueprintCaller,
} from "../src/blueprint-access.js";
import type { BlueprintKvRecord } from "../src/storage-schema/blueprints-kv.js";

const METADATA = {
  title: "T", description: "", author: { type: "user", id: "x", name: "X" },
  created: new Date(0), version: 1, lastUpdated: new Date(0), bindings: {},
};

const BUNDLED: BlueprintKvRecord = { metadata: METADATA as BlueprintKvRecord["metadata"] };
const OWNED: BlueprintKvRecord = { ...BUNDLED, ownerId: "owner-do", tenantId: "org_a", gadgetId: "1" };
const UNATTRIBUTED: BlueprintKvRecord = { ...BUNDLED, ownerId: "owner-do", gadgetId: "1" };

const member = (tenantId: string, userDoId = "someone"): BlueprintCaller => ({ tenantId, userDoId });

function envWith(records: Record<string, BlueprintKvRecord>, clerk = true): Cloudflare.Env {
  return {
    ...(clerk ? { CLERK_ISSUER: "https://clerk.test", CLERK_PUBLISHABLE_KEY: "pk_test_x" } : {}),
    // Only the one binding the reader touches.
    BLUEPRINTS: { get: async (id: string) => id in records ? JSON.stringify(records[id]) : null },
  } as unknown as Cloudflare.Env;
}

describe("mayReadBlueprint", () => {
  it("lets anyone, signed in or not, read a bundled blueprint", () => {
    expect(isBundledBlueprint(BUNDLED)).toBe(true);
    expect(mayReadBlueprint(BUNDLED, undefined)).toBe(true);
    expect(mayReadBlueprint(BUNDLED, member("org_b"))).toBe(true);
  });

  it("lets only the owning tenant read a tenant's blueprint", () => {
    expect(mayReadBlueprint(OWNED, member("org_a"))).toBe(true);
    expect(mayReadBlueprint(OWNED, member("org_b"))).toBe(false);
    expect(mayReadBlueprint(OWNED, member(""))).toBe(false);
    expect(mayReadBlueprint(OWNED, undefined)).toBe(false);
  });

  it("does not let the owner's user id stand in for the tenant once it is known", () => {
    expect(mayReadBlueprint(OWNED, member("org_b", "owner-do"))).toBe(false);
  });

  it("keeps a blueprint that predates tenants to its owner until it is attributed", () => {
    expect(mayReadBlueprint(UNATTRIBUTED, member("org_a", "owner-do"))).toBe(true);
    expect(mayReadBlueprint(UNATTRIBUTED, member("org_a", "teammate-do"))).toBe(false);
    expect(mayReadBlueprint(UNATTRIBUTED, undefined)).toBe(false);
  });
});

describe("readBlueprintFor", () => {
  const records = { bundled: BUNDLED, owned: OWNED, old: UNATTRIBUTED };

  it("answers a refusal exactly as it answers an id that does not exist", async () => {
    const env = envWith(records);
    const refused = await readBlueprintFor(env, "owned", member("org_b"));
    const missing = await readBlueprintFor(env, "no-such-blueprint", member("org_b"));
    expect(refused).toBe(missing);
    expect(refused).toBeNull();
  });

  it("calls onRefused for a blueprint that exists and not for one that does not", async () => {
    const env = envWith(records);
    const refusals: string[] = [];
    await readBlueprintFor(env, "owned", member("org_b"), () => refusals.push("owned"));
    await readBlueprintFor(env, "no-such-blueprint", member("org_b"), () => refusals.push("missing"));
    await readBlueprintFor(env, "owned", member("org_a"), () => refusals.push("allowed"));
    expect(refusals).toEqual(["owned"]);
  });

  it("returns the record to the owning tenant and to everyone for a bundled one", async () => {
    const env = envWith(records);
    expect(await readBlueprintFor(env, "owned", member("org_a"))).toMatchObject({ tenantId: "org_a" });
    expect(await readBlueprintFor(env, "bundled", undefined)).not.toBeNull();
  });

  it("refuses a signed-out caller anything that is not bundled", async () => {
    const env = envWith(records);
    expect(await readBlueprintFor(env, "owned", undefined)).toBeNull();
    expect(await readBlueprintFor(env, "old", undefined)).toBeNull();
  });

  it("changes nothing in a deployment without tenants", async () => {
    const env = envWith(records, false);
    expect(await readBlueprintFor(env, "owned", undefined)).not.toBeNull();
    expect(await readBlueprintFor(env, "owned", member("org_b"))).not.toBeNull();
  });

  it("never reads a reserved key as a blueprint", async () => {
    const env = envWith({ ".adminConfig": BUNDLED });
    expect(await readBlueprintFor(env, ".adminConfig", member("org_a"))).toBeNull();
  });
});

describe("blueprintScreenshotFields", () => {
  const withImage = { screenshot: true as const, lastUpdated: new Date(5) };
  const clerk = envWith({});
  const plain = envWith({}, false);

  it("gives a tenant's image no public URL in a deployment with tenants", () => {
    expect(blueprintScreenshotFields(clerk, "b1", withImage, false)).toEqual({ hasScreenshot: true });
  });

  it("keeps a bundled blueprint's public URL, and every URL without tenants", () => {
    expect(blueprintScreenshotFields(clerk, "b1", withImage, true).screenshotUrl).toMatch(/^\/blueprint-screenshot\/b1\?v=5$/);
    expect(blueprintScreenshotFields(plain, "b1", withImage, false).screenshotUrl).toMatch(/^\/blueprint-screenshot\/b1/);
  });

  it("says there is no image when there is none", () => {
    expect(blueprintScreenshotFields(clerk, "b1", { lastUpdated: new Date(5) }, true))
        .toEqual({ hasScreenshot: false });
  });
});
