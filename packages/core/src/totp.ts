import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time passwords (RFC 6238 over RFC 4226's HOTP), as the
// authenticator apps implement them: HMAC-SHA-1, 6 digits, a 30-second step.
// Pure: no database, no clock of its own (the caller passes the time).

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/** Steps accepted either side of the current one: a phone's clock may be half a minute off. */
export const TOTP_SKEW_STEPS = 1;
/** A new secret's length: 160 bits, the size of the SHA-1 block the RFC recommends. */
export const TOTP_SECRET_BYTES = 20;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 without padding: how authenticator apps take a secret. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The bytes of a base32 text (any case, spaces, dashes and padding ignored); null if it is not base32. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) return null;
    value = ((value << 5) | index) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random secret (160 bits). */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4226: the code for a counter, zero-padded to `digits`. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  // Dynamic truncation: 31 bits from the offset the last nibble names.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The 30-second step a moment (ms since the epoch) falls in. */
export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code an authenticator shows at `timeMs`. */
export function totp(secret: Uint8Array, timeMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(timeMs), digits);
}

/** What someone typed as a code: the digits, whatever spaces they put between them. */
export function normalizeTotpCode(code: string): string {
  return code.replace(/\s/g, "");
}

/**
 * The step `code` is right for at `timeMs`: the current one, or the one
 * before or after (a slow or fast clock); null when it is none of them. The
 * caller keeps the step, to refuse the same code a second time.
 *
 * Every candidate is compared, each in constant time, so the answer's timing
 * says nothing about which step (or how much of a code) matched.
 */
export function verifyTotp(secret: Uint8Array, code: string, timeMs: number): number | null {
  const typed = Buffer.from(normalizeTotpCode(code));
  const now = totpStep(timeMs);
  let matched: number | null = null;
  for (let offset = -TOTP_SKEW_STEPS; offset <= TOTP_SKEW_STEPS; offset++) {
    const step = now + offset;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step));
    // The latest step that matches: what the caller then refuses includes every earlier one.
    if (typed.length === expected.length && timingSafeEqual(typed, expected)) matched = step;
  }
  return matched;
}

/**
 * The `otpauth://` URI an authenticator app reads from a QR code: the issuer
 * and the account (the user's email) it lists the code under, and the secret.
 * SHA-1, 6 digits and 30 seconds are the format's defaults, which every app
 * follows, so they are not spelled out.
 */
export function otpauthUri(issuer: string, account: string, secret: Uint8Array): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}`;
}
