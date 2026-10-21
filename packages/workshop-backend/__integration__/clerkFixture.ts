// Shared by the integration suites that run against a Clerk deployment: a local signing key standing
// in for Clerk's, session tokens minted from it, and RPC sessions opened with Clerk's settings.

import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import { expect, vi } from "vitest";
import server from "../src/server";

export const ISSUER = "https://clerk.test";
export const ORIGIN = "https://workshop.example";
export const CLERK = {
  CLERK_ISSUER: ISSUER,
  CLERK_PUBLISHABLE_KEY: "pk_test_abc",
  CLERK_AUTHORIZED_PARTIES: ORIGIN,
};

let privateKey: KeyLike;
let publicJwk: JWK;
const realFetch = globalThis.fetch;

/** Generates the signing key and answers the issuer's JWKS request with it. Call from beforeAll. */
export async function installClerkIssuer(): Promise<void> {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...await exportJWK(pair.publicKey), alg: "RS256", use: "sig", kid: "test-key" };
  // The issuer's JWKS is the only network the verifier touches.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [publicJwk] });
    return realFetch(input, init);
  });
}

/**
 * Makes the Durable Objects see Clerk's settings too, for suites that exercise a check made inside
 * one (`connect()` only sets them for the request handler). Returns the function that undoes it.
 */
export function useClerkInDurableObjects(): () => void {
  const bindings = env as unknown as Record<string, unknown>;
  const before = Object.fromEntries(Object.keys(CLERK).map(key => [key, bindings[key]]));
  Object.assign(bindings, CLERK);
  return () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete bindings[key]; else bindings[key] = value;
    }
  };
}

/** Options for a session token. `role` is the organization role (default: administrator). */
export type TokenOptions = {
  sub?: string; org?: string; role?: string; name?: string; azp?: string; issuedAt?: number;
  expiresIn?: string;
};

export function mint(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    azp: options.azp ?? ORIGIN,
    ...(options.org ? { o: { id: options.org, rol: options.role ?? "admin" } } : {}),
    ...(options.name ? { name: options.name } : {}),
  })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(options.sub ?? "user_1")
      .setIssuer(ISSUER)
      .setIssuedAt(options.issuedAt)
      .setExpirationTime(options.expiresIn ?? "60s")
      .sign(privateKey);
}

/** Opens an RPC session to the backend, with Clerk's settings and any `extra` env over them. */
export async function connect(extra: Record<string, unknown> = {}): Promise<RpcStub<PublicApi>> {
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

/** What a call fails with, as a value. */
export async function failure(value: PromiseLike<unknown>): Promise<Error & { code?: unknown }> {
  try {
    await value;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected the call to be refused.");
}

let counter = 0;
/** A unique id with a readable prefix. */
export const fresh = (prefix: string) => `${prefix}_${++counter}_${crypto.randomUUID().slice(0, 8)}`;

export async function signIn(publicApi: RpcStub<PublicApi>, options: TokenOptions = {}) {
  return await publicApi.authenticateFromClerk(await mint(options));
}
