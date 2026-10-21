import { describe, expect, it } from "vitest";
import { MAX_SITE_NAME_LENGTH } from "@gadgets/workshop-shared/api";
import {
  effectiveBranding, hasBranding, validateBrandingColor, validateBrandingName,
} from "../src/tenant-branding.js";

describe("validateBrandingName", () => {
  it("returns the name trimmed", () => {
    expect(validateBrandingName("  Acme Corp ")).toBe("Acme Corp");
  });

  it("accepts exactly the longest name and refuses one more", () => {
    expect(validateBrandingName("a".repeat(MAX_SITE_NAME_LENGTH))).toHaveLength(MAX_SITE_NAME_LENGTH);
    expect(() => validateBrandingName("a".repeat(MAX_SITE_NAME_LENGTH + 1))).toThrow("too long");
  });

  it("refuses a blank name and one with control characters", () => {
    expect(() => validateBrandingName("   ")).toThrow("blank");
    expect(() => validateBrandingName("Acme\nCorp")).toThrow("control");
    expect(() => validateBrandingName("Acme\u0000")).toThrow("control");
  });
});

describe("validateBrandingColor", () => {
  it("accepts a hex color in either length", () => {
    expect(() => validateBrandingColor("#3b82f6")).not.toThrow();
    expect(() => validateBrandingColor("#fff")).not.toThrow();
  });

  it("refuses anything that is not a hex color, including CSS that would escape the property", () => {
    for (const bad of ["", "red", "3b82f6", "#3b82f", "#3b82f6;}", "url(x)", "#ggg"]) {
      expect(() => validateBrandingColor(bad)).toThrow("hex color");
    }
  });
});

describe("effectiveBranding", () => {
  const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it("is null when nothing is set, so the deployment's branding shows unchanged", () => {
    expect(hasBranding({})).toBe(false);
    expect(effectiveBranding({ updatedAt: new Date() })).toBeNull();
  });

  it("carries only the parts that are set", () => {
    expect(effectiveBranding({ name: "Acme" })).toEqual({ siteName: "Acme" });
    expect(effectiveBranding({ accentColor: "#112233" })).toEqual({ accentColor: "#112233" });
  });

  it("delivers the logo inline as a PNG data URL", () => {
    expect(effectiveBranding({ logo: LOGO })).toEqual({
      siteLogo: { url: `data:image/png;base64,${LOGO.toBase64()}` },
    });
  });

  it("encodes a logo larger than one chunk without corrupting it", () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    const url = effectiveBranding({ logo: big })!.siteLogo!.url;
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(Uint8Array.fromBase64(url.slice("data:image/png;base64,".length))).toEqual(big);
  });
});
