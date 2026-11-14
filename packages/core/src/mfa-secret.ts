import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// A TOTP secret at rest (`user_mfa.secret`). The database never holds the
// secret itself, so a leaked dump or backup alone does not let anyone compute
// a user's codes: the key is not in the database.
//
// Derivation, written down so it can be reproduced:
//
//   key = HKDF-SHA-256(ikm  = NEXTAUTH_SECRET (its UTF-8 bytes),
//                      salt = "vitah.user_mfa",
//                      info = "totp-secret:v1",
//                      length = 32 bytes)
//
//   stored = "v1." + base64url(iv) + "." + base64url(tag) + "." + base64url(ciphertext)
//
//   AES-256-GCM, a random 96-bit iv per encryption, a 128-bit tag, and the
//   owner's user id as additional authenticated data ("user:<id>"): a
//   ciphertext copied onto another user's row does not decrypt there.
//
// The key is derived, not NEXTAUTH_SECRET itself, so this use is separate
// from the others the same variable has (session cookies, the app's tokens):
// none of them gives anything away about the others.
//
// Rotating NEXTAUTH_SECRET (doc/ops/secrets.md) changes the key: every stored
// secret becomes unreadable, for good (there is no re-encryption step, the
// old key being gone with the old variable). Nothing fails loudly: `openSecret`
// answers null, so an authenticator's codes are simply never right again.
// What still works, because none of it needs the key:
//   - a recovery code (stored as a salted hash) still signs its owner in, and
//     with the password still turns two-step verification off;
//   - an admin still removes anyone else's (Usuarios › "Quitar verificación en
//     dos pasos"), after which that user signs in with the password and
//     enrols again;
//   - as a last resort, `DELETE FROM user_mfa WHERE user_id = …` in the database.
// So after a rotation every enrolled user enrols again. Tell them beforehand.

const VERSION = "v1";
const KEY_SALT = "vitah.user_mfa";
const KEY_INFO = "totp-secret:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, KEY_SALT, KEY_INFO, 32));
}

const aad = (userId: string) => Buffer.from(`user:${userId}`);

/** `secret` encrypted for `userId`'s row. A different text every time (the iv is random). */
export function sealSecret(secret: Uint8Array, userId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [VERSION, ...[iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url"))].join(".");
}

/**
 * The secret back, or null when it cannot be read: not ours, altered, another
 * user's, or sealed under another NEXTAUTH_SECRET. Never throws for those (a
 * code is then simply wrong); only a missing NEXTAUTH_SECRET does.
 */
export function openSecret(stored: string, userId: string): Buffer | null {
  const [version, iv, tag, ciphertext, ...rest] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext || rest.length > 0) return null;
  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return null;
  const derived = key();
  try {
    const decipher = createDecipheriv("aes-256-gcm", derived, ivBytes, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  } catch {
    return null;
  }
}
