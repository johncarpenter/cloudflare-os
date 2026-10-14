import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from "jose";
import { authorizedParties, verifyClerkSessionToken, type ClerkEnv } from "../src/auth/clerk.js";

const ISSUER = "https://clerk.test";
const ENV: ClerkEnv = {
  CLERK_ISSUER: ISSUER,
  CLERK_AUTHORIZED_PARTIES: "https://workshop.example",
};

// Verifies with a real signature check against a locally generated key, so the claim handling under
// test sits behind the same jwtVerify call as production; only the JWKS fetch is replaced.
async function makeSigner() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), alg: "RS256", use: "sig" };
  const key = await importJWK(jwk, "RS256");
  const verifier = async (token: string, env: ClerkEnv) =>
      (await jwtVerify(token, key, { issuer: env.CLERK_ISSUER, algorithms: ["RS256"] })).payload;

  function sign(claims: Record<string, unknown>, overrides: { issuer?: string; expiresIn?: string } = {}) {
    return new SignJWT({ azp: "https://workshop.example", ...claims })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject("user_1")
        .setIssuer(overrides.issuer ?? ISSUER)
        .setIssuedAt()
        .setExpirationTime(overrides.expiresIn ?? "60s")
        .sign(privateKey);
  }
  return { sign, verifier };
}

describe("verifyClerkSessionToken", () => {
  it("accepts a valid token and reads version 2 organization claims", async () => {
    const { sign, verifier } = await makeSigner();
    const token = await sign({ o: { id: "org_a", rol: "admin" }, name: "Ada" });
    const claims = await verifyClerkSessionToken(token, ENV, verifier);
    expect(claims).toMatchObject({ userId: "user_1", orgId: "org_a", orgRole: "admin", name: "Ada" });
    expect(claims!.expiresAt).toBeGreaterThan(claims!.issuedAt);
  });

  it("reads version 1 organization claims, and no organization means none", async () => {
    const { sign, verifier } = await makeSigner();
    const v1 = await verifyClerkSessionToken(
        await sign({ org_id: "org_b", org_role: "org:member" }), ENV, verifier);
    expect(v1).toMatchObject({ orgId: "org_b", orgRole: "org:member" });

    const personal = await verifyClerkSessionToken(await sign({}), ENV, verifier);
    expect(personal!.orgId).toBeUndefined();
  });

  it("refuses a token signed by another key", async () => {
    const { sign } = await makeSigner();
    const other = await makeSigner();
    expect(await verifyClerkSessionToken(await sign({}), ENV, other.verifier)).toBeNull();
  });

  it("refuses the wrong issuer and an expired token", async () => {
    const { sign, verifier } = await makeSigner();
    expect(await verifyClerkSessionToken(
        await sign({}, { issuer: "https://evil.test" }), ENV, verifier)).toBeNull();
    expect(await verifyClerkSessionToken(
        await sign({}, { expiresIn: "-1h" }), ENV, verifier)).toBeNull();
  });

  it("refuses a token issued to another origin or without one", async () => {
    const { sign, verifier } = await makeSigner();
    expect(await verifyClerkSessionToken(
        await sign({ azp: "https://evil.example" }), ENV, verifier)).toBeNull();
    expect(await verifyClerkSessionToken(await sign({ azp: undefined }), ENV, verifier)).toBeNull();
  });

  it("refuses everything when no origin is configured", async () => {
    const { sign, verifier } = await makeSigner();
    expect(await verifyClerkSessionToken(
        await sign({}), { CLERK_ISSUER: ISSUER }, verifier)).toBeNull();
  });
});

describe("authorizedParties", () => {
  it("prefers the explicit list and otherwise uses the origin of the public URL", () => {
    expect(authorizedParties({ CLERK_AUTHORIZED_PARTIES: "https://a.example, https://b.example" }))
        .toEqual(["https://a.example", "https://b.example"]);
    expect(authorizedParties({ PUBLIC_BASE_URL: "https://workshop.example/some/path" }))
        .toEqual(["https://workshop.example"]);
    expect(authorizedParties({})).toEqual([]);
  });
});
