import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyClerkEvent, handleClerkWebhook, verifySvixSignature } from "../src/auth/clerk-webhook.js";
import type { UserDurableObject } from "../src/user.js";
import { makeUserKey, personalTenantId } from "../src/tenant.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

const SECRET_BYTES = new Uint8Array(32).map((_, i) => i + 1);
const SECRET = `whsec_${SECRET_BYTES.toBase64()}`;

async function sign(id: string, timestamp: number, body: string, keyBytes = SECRET_BYTES) {
  const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${new Uint8Array(mac).toBase64()}`;
}

function headers(id: string, timestamp: number, signature: string) {
  return new Headers({
    "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": signature,
  });
}

// Whether a native RPC call was refused, as a value: a rejection left to `.rejects` is also flagged
// as an unhandled rejection by the pool.
async function refused(call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return false;
  } catch {
    return true;
  }
}

const BODY = JSON.stringify({ type: "user.deleted", data: { id: "user_1" } });
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

describe("verifySvixSignature", () => {
  it("accepts a correct signature, including among several during secret rotation", async () => {
    const good = await sign("msg_1", NOW_S, BODY);
    const other = await sign("msg_1", NOW_S, BODY, new Uint8Array(32));
    expect(await verifySvixSignature(headers("msg_1", NOW_S, good), BODY, SECRET, NOW_MS)).toBe(true);
    expect(await verifySvixSignature(
        headers("msg_1", NOW_S, `${other} ${good}`), BODY, SECRET, NOW_MS)).toBe(true);
  });

  it("refuses a tampered body, a wrong secret, a stale timestamp and missing headers", async () => {
    const good = await sign("msg_1", NOW_S, BODY);
    expect(await verifySvixSignature(
        headers("msg_1", NOW_S, good), BODY + " ", SECRET, NOW_MS)).toBe(false);
    expect(await verifySvixSignature(headers("msg_1", NOW_S, good), BODY,
        `whsec_${new Uint8Array(32).toBase64()}`, NOW_MS)).toBe(false);
    expect(await verifySvixSignature(
        headers("msg_1", NOW_S, good), BODY, SECRET, NOW_MS + 6 * 60 * 1000)).toBe(false);
    expect(await verifySvixSignature(new Headers(), BODY, SECRET, NOW_MS)).toBe(false);
  });
});

describe("handleClerkWebhook", () => {
  const clerkEnv = {
    ...env, CLERK_ISSUER: "https://clerk.test", CLERK_PUBLISHABLE_KEY: "pk_test", CLERK_WEBHOOK_SECRET: SECRET,
  } as unknown as Cloudflare.Env;

  const post = async (hdrs: Headers, body: string, e = clerkEnv) =>
      (await handleClerkWebhook(
          new Request("https://workshop.example/api/clerk-webhook", { method: "POST", headers: hdrs, body }),
          e, env.TEST_USER)).status;

  it("is absent unless Clerk and a secret are configured", async () => {
    expect(await post(new Headers(), BODY, env as unknown as Cloudflare.Env)).toBe(404);
  });

  it("rejects an unsigned or badly signed delivery before reading the event", async () => {
    expect(await post(new Headers(), BODY)).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    expect(await post(headers("msg_1", now, await sign("msg_1", now, "other")), BODY)).toBe(401);
  });
});

describe("applyClerkEvent", () => {
  // The first call into a Durable Object loads the whole backend, which can outlast a test's own
  // timeout; pay for it here instead.
  beforeAll(async () => { await env.TEST_USER.getByName("warm-up").whoamiIfExists(); }, 120_000);

  it("ends a membership: earlier sessions are refused, later ones allowed, content kept", async () => {
    const key = makeUserKey("org_hook", "user_hook");
    const user = env.TEST_USER.getByName(key);
    await user.authenticateFromClerk({ userKey: key, displayName: "H", allowCreate: true, tokenIssuedAt: 1_000 });

    await applyClerkEvent({
      type: "organizationMembership.deleted",
      timestamp: 5_000,
      data: { organization: { id: "org_hook" }, public_user_data: { user_id: "user_hook" } },
    }, env.TEST_USER);

    expect(await refused(user.checkClerkSession(5_000))).toBe(true);
    expect(await refused(user.checkClerkSession(4_000))).toBe(true);
    expect(await refused(user.checkClerkSession(6_000))).toBe(false);
    // The account itself, and so its content, is still there.
    expect(await user.whoamiIfExists()).toMatchObject({ id: key });

    // A retried delivery changes nothing.
    await applyClerkEvent({
      type: "organizationMembership.deleted",
      timestamp: 5_000,
      data: { organization: { id: "org_hook" }, public_user_data: { user_id: "user_hook" } },
    }, env.TEST_USER);
    expect(await refused(user.checkClerkSession(6_000))).toBe(false);
  });

  it("erases a deleted user's personal tenant and ends their organization memberships", async () => {
    const personalKey = makeUserKey(personalTenantId("user_gone"), "user_gone");
    const orgKey = makeUserKey("org_gone", "user_gone");
    const personal = env.TEST_USER.getByName(personalKey);
    await personal.authenticateFromClerk({
      userKey: personalKey, displayName: "G", allowCreate: true, tokenIssuedAt: 1_000 });
    await personal.noteKnownTenant("org_gone");
    const org = env.TEST_USER.getByName(orgKey);
    await org.authenticateFromClerk({ userKey: orgKey, displayName: "G", allowCreate: true, tokenIssuedAt: 1_000 });

    await applyClerkEvent({ type: "user.deleted", data: { id: "user_gone" } }, env.TEST_USER, 10_000);

    expect(await env.TEST_USER.getByName(personalKey).whoamiIfExists()).toBeNull();
    expect(await refused(org.checkClerkSession(9_000))).toBe(true);
    expect(await org.whoamiIfExists()).toMatchObject({ id: orgKey });
  });

  it("ignores events it does not handle and malformed payloads", async () => {
    await expect(applyClerkEvent({ type: "session.created", data: {} }, env.TEST_USER)).resolves.toBeUndefined();
    await expect(applyClerkEvent("nope", env.TEST_USER)).resolves.toBeUndefined();
    await expect(applyClerkEvent({ type: "user.deleted", data: {} }, env.TEST_USER)).resolves.toBeUndefined();
  });
});
