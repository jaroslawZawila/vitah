import { describe, expect, it } from "vitest";
import { resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("uses the signed-in user's language over the browser's", () => {
    expect(resolveLocale("en", "es-ES,es;q=0.9")).toBe("en");
    expect(resolveLocale("es", "en-GB,en;q=0.9")).toBe("es");
  });

  it("falls back to the browser's preferred language we have, then Spanish", () => {
    expect(resolveLocale(undefined, "de-DE,en;q=0.8,es;q=0.5")).toBe("en");
    expect(resolveLocale(undefined, "fr-FR,de;q=0.8")).toBe("es");
    expect(resolveLocale(undefined, null)).toBe("es");
    expect(resolveLocale(undefined, "de, en; q=0.8")).toBe("en");
    // q=0: not acceptable.
    expect(resolveLocale(undefined, "en;q=0, fr")).toBe("es");
  });

  it("ignores a language we don't have", () => {
    expect(resolveLocale("fr", "en")).toBe("en");
  });
});
