import { expect } from "vitest";

// What Next's `redirect()` and `notFound()` throw, for tests of pages and
// server actions that leave instead of answering:
//   await expect(getProjectObra(id)).rejects.toEqual(NOT_FOUND);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A `redirect(href)`. */
export const redirectTo = (href: string): unknown =>
  expect.objectContaining({ digest: expect.stringMatching(new RegExp(`^NEXT_REDIRECT;(push|replace);${escaped(href)};`)) });

/** A `notFound()`: the "No encontrado" page. */
export const NOT_FOUND: unknown = expect.objectContaining({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
/** Signed out: on to the login page (`requireSession` in lib/access.ts). */
export const TO_LOGIN = redirectTo("/");
/** The "No tienes permiso" page (`forbidden` in lib/access.ts). */
export const TO_FORBIDDEN = redirectTo("/dashboard/forbidden");
