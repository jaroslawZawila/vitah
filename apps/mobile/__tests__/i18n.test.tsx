import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { I18nProvider, deviceLanguage, useI18n } from "../lib/i18n";
import { en } from "../messages/en";
import { es } from "../messages/es";
import { secureStore } from "../test-utils/secure-store";

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

beforeEach(() => secureStore.clear());

/** Every leaf key path of a messages object. */
function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "string" ? [prefix + key] : keys(value, `${prefix}${key}.`),
  );
}

describe("messages", () => {
  it("has the same keys in Spanish and English", () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });
});

describe("useI18n", () => {
  it("is Spanish without a provider", () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.language).toBe("es");
    expect(result.current.t("tabs.profile")).toBe("Perfil");
  });

  it("fills in parameters and picks plural forms", () => {
    const { result } = renderHook(() => useI18n());
    const { t } = result.current;

    expect(t("home.helloName", { name: "Ana" })).toBe("Hola, Ana");
    expect(t("photos.count", { count: 1 })).toBe("1 foto");
    expect(t("photos.count", { count: 0 })).toBe("0 fotos");
    expect(t("documents.count", { count: 3 })).toBe("3 documentos");
  });

  it("works without Intl.PluralRules, which Hermes (the app's engine) lacks", () => {
    const intl = Intl as { PluralRules?: typeof Intl.PluralRules };
    const { PluralRules } = intl;
    delete intl.PluralRules; // Simulating Hermes.
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      act(() => result.current.setLanguage("en"));
      expect(result.current.t("photos.count", { count: 1 })).toBe("1 photo");
      expect(result.current.t("photos.count", { count: 2 })).toBe("2 photos");
    } finally {
      intl.PluralRules = PluralRules;
    }
  });

  it("switches language and remembers it", async () => {
    const { result } = renderHook(() => useI18n(), { wrapper });

    act(() => result.current.setLanguage("en"));

    expect(result.current.t("tabs.profile")).toBe("Profile");
    expect(result.current.t("photos.count", { count: 1 })).toBe("1 photo");
    await waitFor(() => expect(secureStore.get("vitah_language")).toBe("en"));
  });

  it("restores the remembered language", async () => {
    secureStore.set("vitah_language", "en");

    const { result } = renderHook(() => useI18n(), { wrapper });

    await waitFor(() => expect(result.current.language).toBe("en"));
  });
});

describe("a key without a text", () => {
  // Keys built from what the server sends, e.g. `hitoStatus.${status}`, may name a status this version doesn't know.
  const unknown = (key: string) => key as Parameters<ReturnType<typeof useI18n>["t"]>[0];
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it.each([
    "hitoStatus.disputed", // a new status
    "phase.status.paused",
    "nothing.here.at.all", // a missing group (used to throw)
    "hitoStatus", // a group, not a text
    "hitoStatus.paid.more", // past a text
    "hitoStatus.constructor", // on every object, but not a text
    "hitoStatus.__proto__",
    "hitoStatus.toString",
    "",
    ".",
    "hitoStatus.",
  ])("reads %j as the fallback, never as \"undefined\"", (key) => {
    const { t } = renderHook(() => useI18n()).result.current;

    expect(t(unknown(key))).toBe("—");
    expect(t(unknown(key), undefined, "")).toBe("");
    expect(t(unknown(key), { count: 2 }, "Otro")).toBe("Otro");
  });

  it.each([undefined, null, 42, {}, Symbol("key"), Object.create(null)])(
    "doesn't throw for a key that isn't even text: %p",
    (key) => {
      const { t } = renderHook(() => useI18n()).result.current;

      expect(t(key as never)).toBe("—");
      expect(t(key as never, null as never, "?")).toBe("?");
    },
  );

  it("still reads the texts that exist, with or without a fallback", () => {
    const { t } = renderHook(() => useI18n()).result.current;

    expect(t("hitoStatus.paid", undefined, "?")).toBe("Pagado");
    expect(t("photos.count", { count: 1 }, "?")).toBe("1 foto");
  });

  it("says so once per key in development", () => {
    const { t } = renderHook(() => useI18n()).result.current;

    t(unknown("hitoStatus.onlyWarnedOnce"));
    t(unknown("hitoStatus.onlyWarnedOnce"));
    t(unknown("hitoStatus.onlyWarnedOnce"), undefined, "");

    const warnings = warn.mock.calls.filter(([message]) => String(message).includes("hitoStatus.onlyWarnedOnce"));
    expect(warnings).toEqual([['[i18n] No "es" text for "hitoStatus.onlyWarnedOnce"']]);
  });
});

describe("deviceLanguage", () => {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  afterEach(() => {
    Intl.DateTimeFormat.prototype.resolvedOptions = resolved;
  });

  it.each([
    ["en-GB", "en"],
    ["es-ES", "es"],
    ["de-DE", "es"], // unsupported: Spanish
  ])("%s → %s", (locale, language) => {
    Intl.DateTimeFormat.prototype.resolvedOptions = () =>
      ({ locale }) as Intl.ResolvedDateTimeFormatOptions;

    expect(deviceLanguage()).toBe(language);
  });
});
