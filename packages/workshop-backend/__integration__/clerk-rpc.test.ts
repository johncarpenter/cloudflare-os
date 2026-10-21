import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import {
  AUTH_ERROR_CODES, getAuthErrorCode, getOpenGadgetErrorCode, OPEN_GADGET_ERROR_CODES,
  type PublicApi,
} from "@gadgets/workshop-shared/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import server from "../src/server";
import { makeUserKey, personalTenantId } from "../src/tenant.js";

const ISSUER = "https://clerk.test";
const ORIGIN = "https://workshop.example";
const CLERK = {
  CLERK_ISSUER: ISSUER,
  CLERK_PUBLISHABLE_KEY: "pk_test_abc",
  CLERK_AUTHORIZED_PARTIES: ORIGIN,
};

let privateKey: KeyLike;
let publicJwk: JWK;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...await exportJWK(pair.publicKey), alg: "RS256", use: "sig", kid: "test-key" };
  // The issuer's JWKS is the only network the verifier touches.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [publicJwk] });
    return realFetch(input, init);
  });
}, 120_000);

afterAll(() => { vi.restoreAllMocks(); });

type TokenOptions = {
  sub?: string; org?: string; name?: string; azp?: string; issuedAt?: number; expiresIn?: string;
};

function mint(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    azp: options.azp ?? ORIGIN,
    ...(options.org ? { o: { id: options.org, rol: "admin" } } : {}),
    ...(options.name ? { name: options.name } : {}),
  })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(options.sub ?? "user_1")
      .setIssuer(ISSUER)
      .setIssuedAt(options.issuedAt)
      .setExpirationTime(options.expiresIn ?? "60s")
      .sign(privateKey);
}

async function connect(extra: Record<string, unknown> = {}): Promise<RpcStub<PublicApi>> {
  // Invoke the handler directly so the WebSocket session shares the test's execution context.
  const response = await server.fetch(new Request("https://workshop.invalid/api", {
    headers: { Upgrade: "websocket" },
  }), { ...env, ...CLERK, ...extra } as typeof env, createExecutionContext());
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new TypeError("Expected a WebSocket response.");
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

// What a call fails with, as a value.
async function failure(value: PromiseLike<unknown>): Promise<Error & { code?: unknown }> {
  try {
    await value;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected the call to be refused.");
}

let counter = 0;
const fresh = (prefix: string) => `${prefix}_${++counter}_${crypto.randomUUID().slice(0, 8)}`;

async function signIn(publicApi: RpcStub<PublicApi>, options: TokenOptions = {}) {
  return await publicApi.authenticateFromClerk(await mint(options));
}

describe("Clerk sign-in", () => {
  it("opens a personal tenant keyed by the Clerk user id, and keeps it when the profile changes",
      async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    using first = await signIn(publicApi, { sub, name: "Ada" });
    const profile = await first.whoami();
    expect(profile.id).toBe(makeUserKey(personalTenantId(sub), sub));
    expect(profile.name).toBe("Ada");

    // The same Clerk user with a new display name and email lands in the same workspace.
    using second = await signIn(publicApi, { sub, name: "Ada Lovelace" });
    const again = await second.whoami();
    expect(again.id).toBe(profile.id);
    expect(again.name).toBe("Ada Lovelace");
  });

  it("refuses unusable sessions and creates nothing for them", async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    const key = makeUserKey(personalTenantId(sub), sub);

    for (const token of [
      "not-a-token",
      await mint({ sub, expiresIn: "-1h" }),
      await mint({ sub, azp: "https://evil.example" }),
    ]) {
      expect(getAuthErrorCode(await failure(publicApi.authenticateFromClerk(token))))
          .toBe(AUTH_ERROR_CODES.invalidSessionToken);
    }
    expect(await exports.UserDurableObject.getByName(key).whoamiIfExists()).toBeNull();
  });

  it("does not offer the other sign-in methods", async () => {
    using publicApi = await connect();
    const err = await failure(publicApi.createAccount("someone", "Someone", new Uint8Array([1])));
    expect(err.message).toMatch(/disabled/i);
    const token = await failure(publicApi.authenticate("x:y"));
    expect(getAuthErrorCode(token)).toBe(AUTH_ERROR_CODES.sessionNotPermitted);
    expect((await publicApi.getServerConfig()).clerk).toEqual({ publishableKey: "pk_test_abc" });
  });

  it("refuses Clerk sessions on a deployment without Clerk", async () => {
    using publicApi = await connect({ CLERK_ISSUER: undefined, CLERK_PUBLISHABLE_KEY: undefined });
    expect(getAuthErrorCode(await failure(publicApi.authenticateFromClerk(await mint()))))
        .toBe(AUTH_ERROR_CODES.sessionNotPermitted);
    expect((await publicApi.getServerConfig()).clerk).toBeUndefined();
  });
});

describe("tenants", () => {
  it("puts an organization's members in one tenant and lets the directory see only them", async () => {
    await exports.AdminSettings.getByName("").updateAdminConfig({ userSearchEnabled: true });
    using publicApi = await connect();
    const org = fresh("org");
    const other = fresh("org");
    const stamp = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    using ann = await signIn(publicApi, { sub: fresh("ann"), org, name: `Ann ${stamp}` });
    using _bob = await signIn(publicApi, { sub: fresh("bob"), org, name: `Bob ${stamp}` });
    using eve = await signIn(publicApi, { sub: fresh("eve"), org: other, name: `Eve ${stamp}` });

    expect((await ann.getWorkspaceInfo())).toMatchObject({ tenantId: org, kind: "organization" });
    await expect.poll(async () => (await ann.searchUsers(stamp, [])).map(u => u.name))
        .toEqual([`Bob ${stamp}`]);
    expect((await eve.searchUsers(stamp, [])).map(u => u.name)).toEqual([]);
  });

  it("refuses cross-tenant sharing: adding a collaborator, direct open, and a share link",
      async () => {
    using publicApi = await connect();
    const org = fresh("org");
    const sub = fresh("owner");
    using owner = await signIn(publicApi, { sub, org });
    using teammate = await signIn(publicApi, { sub: fresh("mate"), org });
    using outsider = await signIn(publicApi, { sub: fresh("out"), org: fresh("org") });
    const teammateId = (await teammate.whoami()).id;
    const outsiderId = (await outsider.whoami()).id;

    using workspace = await owner.newGadget();
    const workspaceId = (await workspace.getMetadata()).id;

    // The same tenant works...
    expect(await workspace.addCollaborator(teammateId, "build")).not.toBeNull();
    using shared = teammate.openGadget(workspaceId);
    expect((await shared.getMetadata()).id).toBe(workspaceId);

    // ...and another tenant is answered as if the person did not exist.
    expect(await workspace.addCollaborator(outsiderId, "build")).toBeNull();

    const denied = OPEN_GADGET_ERROR_CODES.workspaceAccessDenied;
    using attempt = outsider.openGadget(workspaceId);
    expect(getOpenGadgetErrorCode(await failure(attempt.getMetadata()))).toBe(denied);

    const link = await workspace.createShareLink("build");
    using viaLink = outsider.openGadget(workspaceId, link.key);
    expect(getOpenGadgetErrorCode(await failure(viaLink.getMetadata()))).toBe(denied);
  });

  it("keeps the same person's workspaces in two tenants apart", async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    using inPersonal = await signIn(publicApi, { sub });
    using inOrg = await signIn(publicApi, { sub, org: fresh("org") });
    expect((await inPersonal.whoami()).id).not.toBe((await inOrg.whoami()).id);
  });
});

describe("single-tenant deployment", () => {
  it("admits only the pinned organization", async () => {
    const pinned = fresh("org");
    using publicApi = await connect({ TENANT_MODE: "single", TENANT_ID: pinned });
    using member = await signIn(publicApi, { sub: fresh("user"), org: pinned });
    expect((await member.getWorkspaceInfo()).tenantId).toBe(pinned);

    const refused = AUTH_ERROR_CODES.sessionNotPermitted;
    const sub = fresh("user");
    expect(getAuthErrorCode(await failure(signIn(publicApi, { sub, org: fresh("org") })))).toBe(refused);
    expect(getAuthErrorCode(await failure(signIn(publicApi, { sub })))).toBe(refused);
    expect(await exports.UserDurableObject.getByName(makeUserKey(personalTenantId(sub), sub))
        .whoamiIfExists()).toBeNull();
  });

  it("refuses everyone when the pin is missing", async () => {
    using publicApi = await connect({ TENANT_MODE: "single" });
    expect(getAuthErrorCode(await failure(signIn(publicApi, { org: fresh("org") }))))
        .toBe(AUTH_ERROR_CODES.sessionNotPermitted);
  });
});

describe("session renewal", () => {
  it("accepts a fresh token for the same user and tenant", async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    const org = fresh("org");
    using api = await signIn(publicApi, { sub, org });
    await api.renewSession(await mint({ sub, org }));
    expect((await api.getWorkspaceInfo()).tenantId).toBe(org);
  });

  it("refuses and ends the session when the user switches organization", async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    using api = await signIn(publicApi, { sub, org: fresh("org") });
    const err = await failure(api.renewSession(await mint({ sub, org: fresh("org") })));
    expect(getAuthErrorCode(err)).toBe(AUTH_ERROR_CODES.sessionNotPermitted);
    // Refused from then on, without waiting for the socket to close.
    expect(getAuthErrorCode(await failure(api.whoami()))).toBe(AUTH_ERROR_CODES.sessionExpired);
  });

  it("refuses a different user's token", async () => {
    using publicApi = await connect();
    using api = await signIn(publicApi, { sub: fresh("user") });
    expect(getAuthErrorCode(await failure(api.renewSession(await mint({ sub: fresh("user") })))))
        .toBe(AUTH_ERROR_CODES.sessionNotPermitted);
  });

  it("refuses a connection that stops renewing", async () => {
    using publicApi = await connect();
    using api = await signIn(publicApi, { sub: fresh("user") });
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now");
    try {
      dateNow.mockReturnValue(now + 74_000);
      expect((await api.whoami()).type).toBe("user");
      dateNow.mockReturnValue(now + 76_000);
      expect(getAuthErrorCode(await failure(api.whoami()))).toBe(AUTH_ERROR_CODES.sessionExpired);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("refuses a renewal once the membership was ended by the webhook path", async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    const org = fresh("org");
    using api = await signIn(publicApi, { sub, org });
    await exports.UserDurableObject.getByName(makeUserKey(org, sub)).endMembership(Date.now() + 1_000);
    const err = await failure(api.renewSession(await mint({ sub, org })));
    expect(getAuthErrorCode(err)).toBe(AUTH_ERROR_CODES.sessionNotPermitted);
  });
});

describe("remembered workspace and operators", () => {
  it("remembers the verified tenant for the user across connections", async () => {
    using publicApi = await connect();
    const sub = fresh("user");
    const org = fresh("org");
    using inOrg = await signIn(publicApi, { sub, org });
    expect((await inOrg.getWorkspaceInfo()).lastWorkspaceId).toBeUndefined();
    await inOrg.rememberWorkspace();

    // Another device, signed in to the personal tenant, is told where the user last was.
    using elsewhere = await signIn(publicApi, { sub });
    expect(await elsewhere.getWorkspaceInfo())
        .toEqual({
          tenantId: personalTenantId(sub), kind: "personal",
          personalTenantId: personalTenantId(sub), lastWorkspaceId: org,
        });
  });

  it("grants admin by Clerk user id in any tenant, never by organization role", async () => {
    const admin = fresh("admin");
    using publicApi = await connect({ ADMINS: [admin] });
    using operator = await signIn(publicApi, { sub: admin, org: fresh("org") });
    expect(await operator.amIAdmin()).toBe(true);
    using orgAdmin = await signIn(publicApi, { sub: fresh("user"), org: fresh("org") });
    expect(await orgAdmin.amIAdmin()).toBe(false);
    expect(await orgAdmin.getAdminApi()).toBeNull();
  });
});

describe("organization deletion", () => {
  const SECRET_BYTES = new Uint8Array(32).map((_, i) => i + 7);
  const WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toBase64()}`;

  // Delivers an event the way Svix does: signed over id, timestamp and body.
  async function deliver(event: unknown): Promise<number> {
    const body = JSON.stringify(event);
    const id = `msg_${crypto.randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
        "raw", SECRET_BYTES, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign(
        "HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    const response = await server.fetch(new Request("https://workshop.invalid/api/clerk-webhook", {
      method: "POST",
      headers: {
        "svix-id": id, "svix-timestamp": String(timestamp),
        "svix-signature": `v1,${new Uint8Array(mac).toBase64()}`,
      },
      body,
    }), { ...env, ...CLERK, CLERK_WEBHOOK_SECRET: WEBHOOK_SECRET } as typeof env,
    createExecutionContext());
    return response.status;
  }

  it("erases every member's data, workspaces and published blueprints, and nothing of another tenant",
      async () => {
    using publicApi = await connect();
    const dead = fresh("org");
    const kept = fresh("org");
    const subA = fresh("ann");
    const subB = fresh("bob");
    using ann = await signIn(publicApi, { sub: subA, org: dead });
    using _bob = await signIn(publicApi, { sub: subB, org: dead });
    using cat = await signIn(publicApi, { sub: fresh("cat"), org: kept });
    const keyA = makeUserKey(dead, subA);
    const keyB = makeUserKey(dead, subB);

    using workspace = await ann.newGadget();
    const workspaceId = (await workspace.getMetadata()).id;

    // A blueprint Ann published: its record, its link, and its stored content.
    const blueprintId = crypto.randomUUID().replaceAll("-", "");
    const userA = exports.UserDurableObject.getByName(keyA);
    const metadata = { title: "T", description: "", created: new Date(), lastUpdated: new Date() };
    await runInDurableObject(userA, async (instance: any, state) => {
      instance.storage.blueprints.put({ id: blueprintId, metadata, gadgetId: "1" });
      await env.BLUEPRINTS.put(
          blueprintId, JSON.stringify({ metadata, ownerId: state.id.toString(), gadgetId: "1" }));
    });
    await env.BLUEPRINT_CONTENT.put(`${blueprintId}/release`, "source");

    // The directory learns of members as they sign in; the erase finds them there.
    await expect.poll(() => exports.UserDirectoryDurableObject.getByName(dead).listUserIds())
        .toEqual([keyA, keyB].toSorted());

    const staleToken = await mint({ sub: subA, org: dead });
    expect(await deliver({
      type: "organization.deleted", timestamp: Date.now(), data: { id: dead, deleted: true },
    })).toBe(204);

    // Members, their directory, workspaces and published blueprint are gone.
    expect(await userA.whoamiIfExists()).toBeNull();
    expect(await exports.UserDurableObject.getByName(keyB).whoamiIfExists()).toBeNull();
    expect(await exports.UserDirectoryDurableObject.getByName(dead).listUserIds()).toEqual([]);
    expect(await env.BLUEPRINTS.get(blueprintId)).toBeNull();
    expect(await env.BLUEPRINT_CONTENT.get(`${blueprintId}/release`)).toBeNull();
    const remaining = await runInDurableObject(
        exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString(workspaceId)),
        async (_instance, state) => (await state.storage.list()).size);
    expect(remaining).toBe(0);

    // A session token issued before the deletion cannot bring a member back.
    using fresh1 = await connect();
    expect(getAuthErrorCode(await failure(fresh1.authenticateFromClerk(staleToken))))
        .toBe(AUTH_ERROR_CODES.sessionNotPermitted);
    expect(await userA.whoamiIfExists()).toBeNull();

    // Another organization is untouched.
    expect((await cat.whoami()).type).toBe("user");
    expect(await exports.UserDirectoryDurableObject.getByName(kept).listUserIds()).toHaveLength(1);

    // A redelivery changes nothing.
    expect(await deliver({
      type: "organization.deleted", timestamp: Date.now(), data: { id: dead, deleted: true },
    })).toBe(204);
  });

  it("never erases the legacy directory, which belongs to every account that predates tenants",
      async () => {
    const error = await failure(exports.UserDirectoryDurableObject.getByName("").eraseTenant(Date.now()));
    expect(error.message).toMatch(/named tenant/);
  });
});
