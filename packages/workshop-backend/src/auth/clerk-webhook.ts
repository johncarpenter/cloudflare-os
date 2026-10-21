// The Clerk webhook (`POST /api/clerk-webhook`): Clerk delivers events through Svix, which signs
// each delivery. Membership removal, account deletion and organization deletion are applied here at
// once; the 30 second session renewal (AuthenticatedApi.renewSession) is the backstop if a delivery
// is late.

import type { UserDirectoryDurableObject } from "../user-directory.js";
import type { UserDurableObject } from "../user.js";
import { createWorkshopLogger } from "../observability";
import { makeUserKey, personalTenantId } from "../tenant.js";
import { isClerkEnabled } from "./config.js";

const logger = createWorkshopLogger("workshop.auth.clerk-webhook");

// Svix rejects deliveries whose timestamp is further than this from now, which bounds replay.
const SVIX_TOLERANCE_MS = 5 * 60 * 1000;
const SECRET_PREFIX = "whsec_";

/**
 * Verifies a Svix signature: `v1,<base64 HMAC-SHA256(secret, "<id>.<timestamp>.<body>")>`, with the
 * header holding one or more space-separated signatures (more than one during secret rotation).
 */
export async function verifySvixSignature(
    headers: Headers, body: string, secret: string, now = Date.now()): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > SVIX_TOLERANCE_MS) return false;

  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.fromBase64(
        secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);

  for (const candidate of signatures.split(" ")) {
    const [version, encoded] = candidate.split(",");
    if (version !== "v1" || !encoded) continue;
    let signature: Uint8Array;
    try {
      signature = Uint8Array.fromBase64(encoded);
    } catch {
      continue;
    }
    // subtle.verify compares in constant time.
    if (await crypto.subtle.verify("HMAC", key, signature, signed)) return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The Durable Objects a Clerk event acts on. */
export type ClerkEventStores = {
  users: DurableObjectNamespace<UserDurableObject>;
  directories: DurableObjectNamespace<UserDirectoryDurableObject>;
};

/** Applies one verified Clerk event. Idempotent, so a retried delivery is harmless. */
export async function applyClerkEvent(
    event: unknown, { users, directories }: ClerkEventStores, now = Date.now())
    : Promise<void> {
  const envelope = asRecord(event);
  const data = asRecord(envelope?.data);
  if (!envelope || !data) return;
  const at = typeof envelope.timestamp === "number" ? envelope.timestamp : now;

  if (envelope.type === "organizationMembership.deleted") {
    const orgId = asId(asRecord(data.organization)?.id);
    const userId = asId(asRecord(data.public_user_data)?.user_id);
    if (!orgId || !userId) return;
    await users.getByName(makeUserKey(orgId, userId)).endMembership(at);
    logger.info("membership ended", {
      event: "clerk.membership.ended", tenantId: orgId, userId,
    });
  } else if (envelope.type === "user.deleted") {
    const userId = asId(data.id);
    if (!userId) return;
    await users.getByName(makeUserKey(personalTenantId(userId), userId)).eraseAccount(at);
    logger.info("account erased", {
      event: "clerk.account.erased", tenantId: personalTenantId(userId), userId,
    });
  } else if (envelope.type === "organization.deleted") {
    // The organization no longer exists, so nobody is left to keep its content for: every member's
    // data in this tenant goes, found through the tenant's directory.
    const orgId = asId(data.id);
    if (!orgId) return;
    await directories.getByName(orgId).eraseTenant(at);
    logger.info("tenant erased", { event: "clerk.tenant.erased", tenantId: orgId });
  }
}

/** Serves `POST /api/clerk-webhook`. */
export async function handleClerkWebhook(
    req: Request, env: Cloudflare.Env, stores: ClerkEventStores): Promise<Response> {
  if (!isClerkEnabled(env) || !env.CLERK_WEBHOOK_SECRET) {
    return new Response("Not Found", { status: 404 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.text();
  if (!await verifySvixSignature(req.headers, body, env.CLERK_WEBHOOK_SECRET)) {
    return new Response("Invalid signature.", { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid body.", { status: 400 });
  }
  try {
    await applyClerkEvent(event, stores);
  } catch (error) {
    // Svix retries a non-2xx delivery, and every step is idempotent.
    logger.error("failed to apply clerk event", { event: "clerk.webhook.failed", error });
    return new Response("Failed.", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
