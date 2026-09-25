import * as SecureStore from "expo-secure-store";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { AppLanguage } from "@repo/core/contract";
import { en } from "../messages/en";
import { es, type Messages } from "../messages/es";

// The app's text in Spanish or English. The client picks the language in
// Perfil; until then it follows the phone (English phones get English,
// everything else Spanish). Usage: `const { t } = useI18n(); t("home.title")`.

const MESSAGES: Record<AppLanguage, Messages> = { es, en };
const LANGUAGE_KEY = "vitah_language";

/** Every leaf key, e.g. "home.title" or "photos.count". */
type Keys<T, Prefix extends string = ""> = {
  // A plural `{ one, other }` is one key too.
  [K in keyof T & string]: T[K] extends string | { one: string; other: string }
    ? `${Prefix}${K}`
    : Keys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
export type MessageKey = Keys<Messages>;

type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

function translator(language: AppLanguage): Translate {
  const plural = new Intl.PluralRules(language);
  return (key, params = {}) => {
    let value: unknown = MESSAGES[language];
    for (const part of key.split(".")) value = (value as Record<string, unknown>)[part];
    if (typeof value === "object" && value !== null) {
      const forms = value as { one: string; other: string };
      value = plural.select(Number(params.count)) === "one" ? forms.one : forms.other;
    }
    return String(value).replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}

/** The phone's language, if the app supports it; otherwise Spanish. */
export function deviceLanguage(): AppLanguage {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return locale.toLowerCase().startsWith("en") ? "en" : "es";
}

type I18nValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: Translate;
};

// Spanish without a provider (e.g. screens rendered alone in tests).
const I18nContext = createContext<I18nValue>({
  language: "es",
  setLanguage: () => {},
  t: translator("es"),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(deviceLanguage);

  useEffect(() => {
    void SecureStore.getItemAsync(LANGUAGE_KEY)
      .then((stored) => {
        if (stored === "es" || stored === "en") setLanguageState(stored);
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void SecureStore.setItemAsync(LANGUAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, t: translator(language) }),
    [language, setLanguage],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n() {
  return use(I18nContext);
}
