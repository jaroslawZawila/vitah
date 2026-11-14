import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSecret, sealSecret } from "../src/mfa-secret";

const SECRET = Buffer.from("12345678901234567890");

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "one-secret-of-the-deployment");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a TOTP secret at rest", () => {
  it("comes back as it went in, for the user it was sealed for", () => {
    const stored = sealSecret(SECRET, "user-1");

    expect(openSecret(stored, "user-1")?.equals(SECRET)).toBe(true);
  });

  it("is stored as v1.iv.tag.ciphertext, with nothing of the secret readable in it", () => {
    const stored = sealSecret(SECRET, "user-1");
    const [version, iv, tag, ciphertext] = stored.split(".");

    expect(version).toBe("v1");
    expect(Buffer.from(iv!, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag!, "base64url")).toHaveLength(16);
    expect(Buffer.from(ciphertext!, "base64url")).toHaveLength(SECRET.length);
    expect(Buffer.from(ciphertext!, "base64url").equals(SECRET)).toBe(false);
    expect(stored).not.toContain(SECRET.toString());
    expect(stored).not.toContain(SECRET.toString("base64url"));
  });

  it("is another text every time (a random iv)", () => {
    expect(sealSecret(SECRET, "user-1")).not.toBe(sealSecret(SECRET, "user-1"));
  });

  it.each([
    ["the ciphertext", 3],
    ["the tag", 2],
    ["the iv", 1],
  ])("is refused once %s is altered", (_what, part) => {
    const parts = sealSecret(SECRET, "user-1").split(".");
    const bytes = Buffer.from(parts[part]!, "base64url");
    bytes[0] = bytes[0]! ^ 1;
    parts[part] = bytes.toString("base64url");

    expect(openSecret(parts.join("."), "user-1")).toBeNull();
  });

  it("does not open on another user's row", () => {
    expect(openSecret(sealSecret(SECRET, "user-1"), "user-2")).toBeNull();
  });

  it("fails cleanly under another NEXTAUTH_SECRET: null, no error", () => {
    const stored = sealSecret(SECRET, "user-1");
    vi.stubEnv("NEXTAUTH_SECRET", "the-secret-after-a-rotation");

    expect(openSecret(stored, "user-1")).toBeNull();
    // And what is sealed from then on opens again.
    expect(openSecret(sealSecret(SECRET, "user-1"), "user-1")?.equals(SECRET)).toBe(true);
  });

  it.each(["", "v1", "v1.a.b", "v2.a.b.c", "v1.a.b.c.d", "not sealed at all", "v1...", "v1.AAAA.AAAA.AAAA"])(
    "answers null for the malformed %j",
    (stored) => {
      expect(openSecret(stored, "user-1")).toBeNull();
    },
  );

  it("needs NEXTAUTH_SECRET: it never falls back to a key of its own", () => {
    const stored = sealSecret(SECRET, "user-1");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    expect(() => sealSecret(SECRET, "user-1")).toThrow("NEXTAUTH_SECRET is not set");
    expect(() => openSecret(stored, "user-1")).toThrow("NEXTAUTH_SECRET is not set");
  });
});
