import { describe, expect, it } from "vitest";
import {
  makeUserKey, personalTenantId, resolveTenant, sameTenant, tenantOfProfileId, userIdOfProfileId,
} from "../src/tenant.js";

describe("user keys", () => {
  it("round-trips tenant and user, and legacy ids belong to the legacy tenant", () => {
    const key = makeUserKey("org_a", "user_1");
    expect(tenantOfProfileId(key)).toBe("org_a");
    expect(userIdOfProfileId(key)).toBe("user_1");

    expect(tenantOfProfileId("alice@example.com")).toBe("");
    expect(userIdOfProfileId("alice@example.com")).toBe("alice@example.com");
  });

  it("keeps the same person in two tenants apart, and two people in one tenant together", () => {
    expect(sameTenant(makeUserKey("org_a", "user_1"), makeUserKey("org_a", "user_2"))).toBe(true);
    expect(sameTenant(makeUserKey("org_a", "user_1"), makeUserKey("org_b", "user_1"))).toBe(false);
    // A legacy account is never in a Clerk tenant.
    expect(sameTenant("alice", makeUserKey("org_a", "alice"))).toBe(false);
    expect(sameTenant("alice", "bob")).toBe(true);
  });

  it("refuses a part that would let one user key be read as another", () => {
    expect(() => makeUserKey("org_a\u0000x", "user_1")).toThrow();
    expect(() => makeUserKey("org_a", "user\u0000_1")).toThrow();
    expect(() => makeUserKey("", "user_1")).toThrow();
  });
});

describe("resolveTenant", () => {
  it("uses the active organization, else a personal tenant", () => {
    const org = resolveTenant({}, { userId: "user_1", orgId: "org_a", orgRole: "org:admin" });
    expect(org).toMatchObject({ ok: true, tenant: { tenantId: "org_a", kind: "organization" } });

    const personal = resolveTenant({}, { userId: "user_1" });
    expect(personal).toMatchObject({
      ok: true,
      tenant: { tenantId: personalTenantId("user_1"), kind: "personal" },
    });
  });

  it("pins a single-tenant deployment to its organization", () => {
    const env = { TENANT_MODE: "single", TENANT_ID: "org_a" };
    expect(resolveTenant(env, { userId: "u", orgId: "org_a" }).ok).toBe(true);
    expect(resolveTenant(env, { userId: "u", orgId: "org_b" }))
        .toEqual({ ok: false, reason: "wrong-tenant" });
    // No organization is not the pinned one: a personal tenant is never created in single mode.
    expect(resolveTenant(env, { userId: "u" })).toEqual({ ok: false, reason: "wrong-tenant" });
  });

  it("fails closed when single-tenant mode has no tenant to pin", () => {
    expect(resolveTenant({ TENANT_MODE: "single" }, { userId: "u", orgId: "org_a" }))
        .toEqual({ ok: false, reason: "misconfigured" });
  });
});
