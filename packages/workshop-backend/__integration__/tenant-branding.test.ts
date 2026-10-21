import { exports } from "cloudflare:workers";
import { AUTH_ERROR_CODES, getAuthErrorCode, MAX_SITE_NAME_LENGTH } from "@gadgets/workshop-shared/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connect, failure, fresh, installClerkIssuer, mint, signIn, useClerkInDurableObjects,
} from "./clerkFixture";

function png(width = 64, height = 32, byteLength = 40): Uint8Array {
  const data = new Uint8Array(byteLength);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

let undoClerk: () => void;
const settings = () => exports.AdminSettings.getByName("");

beforeAll(async () => {
  await installClerkIssuer();
  undoClerk = useClerkInDurableObjects();
}, 120_000);

// A test that turns the operator switch off must not leave it off.
afterEach(async () => { await settings().updateAdminConfig({ tenantBrandingEnabled: true }); });

afterAll(() => {
  undoClerk();
  vi.restoreAllMocks();
});

describe("organization branding", () => {
  it("is set by an organization administrator and seen by every member, and by no one else",
      async () => {
    const org = fresh("org");
    using publicApi = await connect();
    using admin = await signIn(publicApi, { sub: fresh("ann"), org, role: "admin" });
    using member = await signIn(publicApi, { sub: fresh("tom"), org, role: "basic_member" });
    using outsider = await signIn(publicApi, { sub: fresh("bob"), org: fresh("org"), role: "admin" });

    expect(await member.getBranding()).toBeNull();

    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "  Acme Corp ", accentColor: "#112233" });
    await manage.setLogo(png());

    const seen = await member.getBranding();
    expect(seen?.siteName).toBe("Acme Corp");
    expect(seen?.accentColor).toBe("#112233");
    expect(seen?.siteLogo?.url).toMatch(/^data:image\/png;base64,/);
    expect(await outsider.getBranding()).toBeNull();

    // The administrator edits what is saved, logo bytes included.
    const saved = await manage.getBranding();
    expect(saved.name).toBe("Acme Corp");
    expect([...saved.logo!]).toEqual([...png()]);
  });

  it("is offered to administrators of an organization only", async () => {
    using publicApi = await connect();
    using member = await signIn(publicApi, { sub: fresh("tom"), org: fresh("org"), role: "basic_member" });
    expect(await member.getTenantAdminApi()).toBeNull();
    // A personal workspace has no organization to brand, whatever the user is there.
    using personal = await signIn(publicApi, { sub: fresh("solo") });
    expect(await personal.getTenantAdminApi()).toBeNull();
    expect(await personal.getBranding()).toBeNull();
  });

  it("refuses a capability held after the role was removed, without a reconnect", async () => {
    const org = fresh("org");
    const sub = fresh("ann");
    using publicApi = await connect();
    using admin = await signIn(publicApi, { sub, org, role: "admin" });
    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "Before" });

    await admin.renewSession(await mint({ sub, org, role: "basic_member" }));

    const refused = await failure(manage.setIdentity({ name: "After" }));
    expect(getAuthErrorCode(refused)).toBe(AUTH_ERROR_CODES.sessionNotPermitted);
    expect((await failure(manage.getBranding())).message).toBe(refused.message);
    expect(await admin.getTenantAdminApi()).toBeNull();
    // Nothing was written by the refused call.
    expect((await admin.getBranding())?.siteName).toBe("Before");
  });

  it("leaves what is saved untouched when a change is refused", async () => {
    const org = fresh("org");
    using publicApi = await connect();
    using admin = await signIn(publicApi, { sub: fresh("ann"), org, role: "admin" });
    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "Acme", accentColor: "#112233" });
    await manage.setLogo(png());

    await failure(manage.setIdentity({ name: "   " }));
    await failure(manage.setIdentity({ name: "a".repeat(MAX_SITE_NAME_LENGTH + 1) }));
    await failure(manage.setIdentity({ name: "Valid", accentColor: "url(javascript:x)" }));
    await failure(manage.setLogo(new Uint8Array([0xff, 0xd8, 0xff])));
    await failure(manage.setLogo(png(100_000, 10)));

    const saved = await manage.getBranding();
    expect(saved.name).toBe("Acme");
    expect(saved.accentColor).toBe("#112233");
    expect([...saved.logo!]).toEqual([...png()]);
  });

  it("clears a part, and the whole when every part is cleared", async () => {
    const org = fresh("org");
    using publicApi = await connect();
    using admin = await signIn(publicApi, { sub: fresh("ann"), org, role: "admin" });
    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "Acme", accentColor: "#112233" });
    await manage.setLogo(png());

    await manage.setLogo(null);
    await manage.setIdentity({ accentColor: null });
    expect(await admin.getBranding()).toEqual({ siteName: "Acme" });

    await manage.setIdentity({ name: null });
    expect(await admin.getBranding()).toBeNull();
  });
});

describe("the operator's control of organization branding", () => {
  it("lists organizations with branding, and clearing one returns its members to the deployment's",
      async () => {
    const org = fresh("org");
    const operatorId = fresh("op");
    using publicApi = await connect({ ADMINS: [operatorId] });
    using admin = await signIn(publicApi, { sub: fresh("ann"), org, role: "admin" });
    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "Acme" });

    using operator = await signIn(publicApi, { sub: operatorId, org: fresh("org") });
    using adminApi = (await operator.getAdminApi())!;
    expect((await adminApi.listTenantBranding()).map(b => b.tenantId)).toContain(org);

    await adminApi.clearTenantBranding(org);
    expect((await adminApi.listTenantBranding()).map(b => b.tenantId)).not.toContain(org);
    expect(await admin.getBranding()).toBeNull();
    // Clearing again is a no-op; an id that cannot name a tenant is refused.
    await adminApi.clearTenantBranding(org);
    await failure(adminApi.clearTenantBranding(""));
  });

  it("is not available to an organization administrator", async () => {
    using publicApi = await connect();
    using admin = await signIn(publicApi, { sub: fresh("ann"), org: fresh("org"), role: "admin" });
    expect(await admin.getAdminApi()).toBeNull();
  });

  it("turning it off hides branding and the settings but keeps what was saved", async () => {
    const org = fresh("org");
    const operatorId = fresh("op");
    using publicApi = await connect({ ADMINS: [operatorId] });
    using admin = await signIn(publicApi, { sub: fresh("ann"), org, role: "admin" });
    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "Acme" });

    using operator = await signIn(publicApi, { sub: operatorId, org: fresh("org") });
    using adminApi = (await operator.getAdminApi())!;
    await adminApi.setTenantBrandingEnabled(false);
    expect((await adminApi.getSettings()).tenantBrandingEnabled).toBe(false);

    expect(await admin.getBranding()).toBeNull();
    expect(await admin.getTenantAdminApi()).toBeNull();
    // A capability obtained before the switch no longer works either.
    await failure(manage.setIdentity({ name: "Changed" }));

    await adminApi.setTenantBrandingEnabled(true);
    expect((await admin.getBranding())?.siteName).toBe("Acme");
  });

  it("erasing an organization removes its branding and its operator listing", async () => {
    const org = fresh("org");
    using publicApi = await connect();
    using admin = await signIn(publicApi, { sub: fresh("ann"), org, role: "admin" });
    using manage = (await admin.getTenantAdminApi())!;
    await manage.setIdentity({ name: "Acme" });
    await manage.setLogo(png());

    await exports.UserDirectoryDurableObject.getByName(org).eraseTenant(Date.now());

    expect(await exports.UserDirectoryDurableObject.getByName(org).getBranding()).toEqual({});
    expect((await settings().listTenantBranding()).map(b => b.tenantId)).not.toContain(org);
  });
});
