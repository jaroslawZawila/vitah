import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totp,
  totpStep,
  verifyTotp,
} from "../src/totp";

// The RFCs' own secret: the ASCII bytes of "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("hotp", () => {
  // RFC 4226, appendix D.
  it.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ])("counter %i is %s", (counter, code) => {
    expect(hotp(RFC_SECRET, counter)).toBe(code);
  });
});

describe("totp", () => {
  // RFC 6238, appendix B (the SHA-1 rows; the RFC prints eight digits).
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("at %i s the RFC's code is %s", (seconds, code) => {
    expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(code);
    // What an authenticator shows: the same, cut to six digits.
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(code.slice(2));
  });

  it("keeps a code's leading zeros", () => {
    expect(totp(RFC_SECRET, 1111111109 * 1000)).toBe("081804");
  });

  it("changes every 30 seconds, on the half minute", () => {
    expect(totpStep(59_999)).toBe(1);
    expect(totpStep(60_000)).toBe(2);
    expect(totp(RFC_SECRET, 30_000)).toBe(totp(RFC_SECRET, 59_999));
    expect(totp(RFC_SECRET, 60_000)).not.toBe(totp(RFC_SECRET, 59_999));
  });
});

describe("verifyTotp", () => {
  const NOW = 1111111111 * 1000;
  const step = totpStep(NOW);
  const at = (steps: number) => hotp(RFC_SECRET, step + steps);

  it("accepts the current code and names its step", () => {
    expect(verifyTotp(RFC_SECRET, at(0), NOW)).toBe(step);
  });

  it("accepts the step before and the step after, for a clock half a minute off", () => {
    expect(verifyTotp(RFC_SECRET, at(-1), NOW)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, at(1), NOW)).toBe(step + 1);
  });

  it.each([-3, -2, 2, 3])("refuses a code %i steps away", (steps) => {
    expect(verifyTotp(RFC_SECRET, at(steps), NOW)).toBeNull();
  });

  it("ignores the spaces someone types between the digits", () => {
    const code = at(0);
    expect(verifyTotp(RFC_SECRET, ` ${code.slice(0, 3)} ${code.slice(3)} `, NOW)).toBe(step);
  });

  it.each(["", "12345", "1234567", "abcdef", "12345a", "050471 1"])("refuses %j", (code) => {
    expect(verifyTotp(RFC_SECRET, code, NOW)).toBeNull();
  });

  it("refuses another secret's code", () => {
    const other = Buffer.from("09876543210987654321");
    expect(verifyTotp(RFC_SECRET, hotp(other, step), NOW)).toBeNull();
  });
});

describe("base32", () => {
  // RFC 4648, section 10 (without the padding).
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("encodes %j as %s, and back", (text, encoded) => {
    expect(base32Encode(Buffer.from(text))).toBe(encoded);
    expect(base32Decode(encoded)?.toString()).toBe(text);
  });

  it("reads what a person types: lower case, spaces, dashes, padding", () => {
    expect(base32Decode("mzxw 6ytb-oi======")?.toString()).toBe("foobar");
  });

  it("refuses what is not base32", () => {
    expect(base32Decode("MZXW1")).toBeNull();
    expect(base32Decode("MZXW!")).toBeNull();
  });
});

describe("a new secret", () => {
  it("is 160 random bits: 32 base32 characters, another every time", () => {
    const one = generateTotpSecret();
    const two = generateTotpSecret();

    expect(one).toHaveLength(20);
    expect(base32Encode(one)).toMatch(/^[A-Z2-7]{32}$/);
    expect(one.equals(two)).toBe(false);
    expect(base32Decode(base32Encode(one))?.equals(one)).toBe(true);
  });
});

describe("otpauthUri", () => {
  it("names the issuer, the account and the secret", () => {
    expect(otpauthUri("ViTAH", "laura@vitah.es", RFC_SECRET)).toBe(
      "otpauth://totp/ViTAH:laura%40vitah.es?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ViTAH",
    );
  });

  it("escapes what an address may carry", () => {
    expect(otpauthUri("ViTAH", "a+b&c=d@vitah.es", RFC_SECRET)).toContain("ViTAH:a%2Bb%26c%3Dd%40vitah.es?secret=");
  });
});
