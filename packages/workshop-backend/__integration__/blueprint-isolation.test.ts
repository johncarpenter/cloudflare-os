import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { RpcStub } from "capnweb";
import {
  BLUEPRINT_SCREENSHOT_PATH_PREFIX, BLUEPRINT_SCREENSHOT_R2_PREFIX, type AuthenticatedApi,
  type PublicApi,
} from "@gadgets/workshop-shared/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminSettings } from "../src/admin-settings.js";
import server from "../src/server";
import { BUNDLED_BLUEPRINTS } from "../src/generated/bundled-blueprints.js";
import { parseBlueprintKvRecord } from "../src/storage-schema/blueprints-kv.js";
import {
  CLERK, connect, failure, fresh, installClerkIssuer, signIn, useClerkInDurableObjects,
} from "./clerkFixture";

const BUNDLED_ID = BUNDLED_BLUEPRINTS[0].blueprintId;
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let undoClerk: () => void;

beforeAll(async () => {
  await installClerkIssuer();
  undoClerk = useClerkInDurableObjects();
  expect(await exports.AdminSettings.getByName("").ensureBundledBlueprintsInstalled()).toBe(true);
}, 120_000);

afterAll(() => {
  undoClerk();
  vi.restoreAllMocks();
});

async function download(api: RpcStub<PublicApi> | RpcStub<AuthenticatedApi>, id: string): Promise<Uint8Array> {
  return new Uint8Array(await new Response(await api.downloadBlueprint(id)).arrayBuffer());
}

// Publishes a copy of the bundled blueprint as `api`'s own, the way a user imports a blueprint.
async function publish(api: RpcStub<AuthenticatedApi>): Promise<string> {
  return await api.importBlueprint(await api.downloadBlueprint(BUNDLED_ID));
}

async function screenshotRoute(id: string): Promise<Response> {
  return await server.fetch(
      new Request(`https://workshop.invalid${BLUEPRINT_SCREENSHOT_PATH_PREFIX}${id}`),
      { ...env, ...CLERK } as typeof env, createExecutionContext());
}

// Gives blueprint `id` an image, optionally as a record nobody owns.
async function giveImage(id: string, options: { unowned?: boolean } = {}): Promise<void> {
  const record = parseBlueprintKvRecord((await env.BLUEPRINTS.get(id))!);
  record.metadata.screenshot = true;
  if (options.unowned) {
    delete record.ownerId;
    delete record.tenantId;
  }
  await env.BLUEPRINTS.put(id, JSON.stringify(record));
  await env.BLUEPRINT_CONTENT.put(`${BLUEPRINT_SCREENSHOT_R2_PREFIX}${id}`, IMAGE,
      { httpMetadata: { contentType: "image/png" } });
}

describe("a blueprint published by one tenant", () => {
  const orgA = fresh("org");
  const orgB = fresh("org");
  let id: string;

  beforeAll(async () => {
    using publicApi = await connect();
    using author = await signIn(publicApi, { sub: fresh("ann"), org: orgA });
    id = await publish(author);
  });

  it("is read by its own tenant, including a teammate who did not publish it", async () => {
    using publicApi = await connect();
    using teammate = await signIn(publicApi, { sub: fresh("tom"), org: orgA });
    expect((await teammate.getBlueprint(id))?.id).toBe(id);
    expect((await download(teammate, id)).byteLength).toBeGreaterThan(0);
    await teammate.addBlueprintToLibrary(id);
  });

  it("is invisible to another tenant on every surface, exactly like an id that does not exist",
      async () => {
    using publicApi = await connect();
    using outsider = await signIn(publicApi, { sub: fresh("bob"), org: orgB });
    const unknown = "no-such-blueprint";

    expect(await outsider.getBlueprint(id)).toBeNull();
    expect(await outsider.getBlueprint(unknown)).toBeNull();
    expect(await outsider.getBlueprintScreenshot(id)).toBeNull();

    const refusedDownload = await failure(outsider.downloadBlueprint(id));
    const missingDownload = await failure(outsider.downloadBlueprint(unknown));
    expect(refusedDownload.message).toBe(missingDownload.message);

    const refusedLibrary = await failure(outsider.addBlueprintToLibrary(id));
    const missingLibrary = await failure(outsider.addBlueprintToLibrary(unknown));
    expect(refusedLibrary.message).toBe(missingLibrary.message);

    const refusedGadget = await failure(outsider.newGadgetFromBlueprint(id, {}));
    const missingGadget = await failure(outsider.newGadgetFromBlueprint(unknown, {}));
    expect(refusedGadget.message).toBe(missingGadget.message);

    expect(await outsider.listLibraryBlueprints()).toEqual([]);
    expect((await outsider.listFeaturedBlueprints()).map(b => b.id)).not.toContain(id);
  });

  it("is invisible to someone not signed in", async () => {
    using publicApi = await connect();
    expect(await publicApi.getBlueprint(id)).toBeNull();
    const refused = await failure(publicApi.downloadBlueprint(id));
    const missing = await failure(publicApi.downloadBlueprint("no-such-blueprint"));
    expect(refused.message).toBe(missing.message);
  });

  it("is never returned from the public image route, which a shared cache would keep", async () => {
    await giveImage(id);
    const unknown = await screenshotRoute("no-such-blueprint");
    const refused = await screenshotRoute(id);
    expect(refused.status).toBe(404);
    expect(refused.status).toBe(unknown.status);
    expect(await refused.text()).toBe(await unknown.text());
    expect(refused.headers.get("Cache-Control")).toBe(unknown.headers.get("Cache-Control"));
  });

  it("has an image its own tenant can fetch over RPC, and no public URL", async () => {
    await giveImage(id);
    using publicApi = await connect();
    using member = await signIn(publicApi, { sub: fresh("ann"), org: orgA });
    const info = await member.getBlueprint(id);
    expect(info?.hasScreenshot).toBe(true);
    expect(info?.screenshotUrl).toBeUndefined();
    const image = await member.getBlueprintScreenshot(id);
    expect(image?.contentType).toBe("image/png");
    expect([...image!.bytes]).toEqual([...IMAGE]);

    using outsider = await signIn(publicApi, { sub: fresh("bob"), org: orgB });
    expect(await outsider.getBlueprintScreenshot(id)).toBeNull();
  });

  it("cannot be made a standard format or featured by an operator", async () => {
    const admin = fresh("admin");
    using publicApi = await connect({ ADMINS: [admin] });
    using operator = await signIn(publicApi, { sub: admin, org: fresh("org") });
    using adminApi = (await operator.getAdminApi())!;
    const promoted = await failure(adminApi.promoteFormat(id));
    expect(promoted.message).toMatch(/bundled/);
    expect(await adminApi.isBlueprintFeatured(id)).toBeNull();
    const featured = await failure(adminApi.setBlueprintFeatured(id, true));
    expect(featured.message).toMatch(/featureable/);
  });
});

describe("a bundled blueprint", () => {
  it("is read by everyone, signed in or not, on every surface", async () => {
    using publicApi = await connect();
    expect((await publicApi.getBlueprint(BUNDLED_ID))?.id).toBe(BUNDLED_ID);
    expect((await download(publicApi, BUNDLED_ID)).byteLength).toBeGreaterThan(0);
    using member = await signIn(publicApi, { sub: fresh("ann"), org: fresh("org") });
    expect((await member.getBlueprint(BUNDLED_ID))?.id).toBe(BUNDLED_ID);
    expect((await download(member, BUNDLED_ID)).byteLength).toBeGreaterThan(0);
    await member.addBlueprintToLibrary(BUNDLED_ID);
  });

  it("keeps its public image, which has no owner to leak", async () => {
    const bundledLike = await (async () => {
      using publicApi = await connect();
      using author = await signIn(publicApi, { sub: fresh("ann"), org: fresh("org") });
      return await publish(author);
    })();
    await giveImage(bundledLike, { unowned: true });
    const response = await screenshotRoute(bundledLike);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...IMAGE]);
  });
});

describe("a blueprint published before tenants existed", () => {
  it("is readable by its owner alone until it is attributed, then by the owner's tenant", async () => {
    const org = fresh("org");
    using publicApi = await connect();
    using owner = await signIn(publicApi, { sub: fresh("ann"), org });
    using teammate = await signIn(publicApi, { sub: fresh("tom"), org });
    const id = await publish(owner);

    // As it was stored before tenants: an owner, no tenant.
    const record = parseBlueprintKvRecord((await env.BLUEPRINTS.get(id))!);
    delete record.tenantId;
    await env.BLUEPRINTS.put(id, JSON.stringify(record));

    expect((await owner.getBlueprint(id))?.id).toBe(id);
    expect(await teammate.getBlueprint(id)).toBeNull();
    expect(await publicApi.getBlueprint(id)).toBeNull();

    // A fresh AdminSettings has attributed nothing yet; it shares the deployment's blueprints.
    expect(await exports.AdminSettings.getByName(fresh("sweep")).ensureBlueprintTenants()).toBe(true);

    expect(parseBlueprintKvRecord((await env.BLUEPRINTS.get(id))!).tenantId).toBe(org);
    expect((await teammate.getBlueprint(id))?.id).toBe(id);
    using outsider = await signIn(publicApi, { sub: fresh("bob"), org: fresh("org") });
    expect(await outsider.getBlueprint(id)).toBeNull();
  });

  it("is taken out of the shared featured list when it is attributed", async () => {
    const org = fresh("org");
    using publicApi = await connect();
    using owner = await signIn(publicApi, { sub: fresh("ann"), org });
    const id = await publish(owner);
    const settings = exports.AdminSettings.getByName(fresh("sweep"));
    const featuredIds = () => runInDurableObject(settings,
        (instance: AdminSettings) => [...instance["storage"].featuredBlueprints.list()].map(b => b.id));
    // A featured entry for it, as one an operator made before tenants existed.
    const info = (await owner.getBlueprint(id))!;
    await settings.syncFeaturedBlueprint(info);
    expect(await featuredIds()).toContain(id);

    await settings.ensureBlueprintTenants();
    expect(await featuredIds()).not.toContain(id);
  });
});
