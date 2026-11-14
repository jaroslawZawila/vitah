import * as SecureStore from "expo-secure-store";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { AppLanguage } from "@repo/core/contract";
import { en } from "../messages/en";
import { es, type Messages } from "../messages/es";
import { reportError } from "./report-error";

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
/**
 * `fallback` is what a key that doesn't exist reads as ("—" unless given):
 * pass one wherever the key is built from what the server sent (a status the
 * app doesn't know yet), e.g. `t(`hitoStatus.${status}`, undefined, "")`.
 */
export type Translate = (key: MessageKey, params?: Params, fallback?: string) => string;

/** What a missing text reads as when the caller gave nothing better. */
const MISSING_TEXT = "—";

/** The text at `key`, or undefined when there is none there (never throws, whatever the key). */
function lookup(messages: Messages, key: unknown): string | { one: string; other: string } | undefined {
  if (typeof key !== "string") return undefined;
  let value: unknown = messages;
  for (const part of key.split(".")) {
    // Own keys only: "constructor" or "__proto__" from a server value are not texts.
    if (typeof value !== "object" || value === null || !Object.prototype.hasOwnProperty.call(value, part)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value === "string") return value;
  const forms = value as { one?: unknown; other?: unknown } | null;
  if (typeof forms === "object" && forms !== null && typeof forms.one === "string" && typeof forms.other === "string") {
    return forms as { one: string; other: string };
  }
  return undefined; // A group of texts, not a text.
}

const missingSeen = new Set<string>();
/** Far more than the app's server-built keys could miss; past it, missing keys go unsaid. */
const MAX_MISSING_SEEN = 200;

/** A key without a text: said once, in development on the console, in a build to the portal. */
function noteMissing(language: AppLanguage, key: unknown) {
  try {
    const name = String(key).slice(0, 120);
    if (missingSeen.has(name) || missingSeen.size >= MAX_MISSING_SEEN) return;
    missingSeen.add(name);
    if (__DEV__) console.warn(`[i18n] No "${language}" text for "${name}"`);
    void reportError(new Error(`Missing translation: ${name}`));
  } catch {
    // A key that can't even be named: the fallback is shown all the same.
  }
}

function translator(language: AppLanguage): Translate {
  return (key, params, fallback = MISSING_TEXT) => {
    const values = params ?? {};
    let value = lookup(MESSAGES[language], key);
    if (value === undefined) {
      noteMissing(language, key);
      return fallback;
    }
    if (typeof value === "object") {
      // Spanish and English: "one" for exactly 1. (Not Intl.PluralRules:
      // Hermes, the app's JS engine, doesn't have it.)
      value = Number(values.count) === 1 ? value.one : value.other;
    }
    return value.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}

/** The phone's language, if the app supports it; otherwise Spanish. */
export function deviceLanguage(): AppLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.toLowerCase().startsWith("en") ? "en" : "es";
  } catch {
    return "es"; // The engine can't tell: the default.
  }
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
