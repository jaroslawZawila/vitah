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
