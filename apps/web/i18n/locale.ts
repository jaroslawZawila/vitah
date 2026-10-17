import { isAppLanguage, type AppLanguage } from "@repo/core/contract";

export const DEFAULT_LOCALE: AppLanguage = "es";

/** The browser's preferred language among ours (es, en), else Spanish. */
function preferredLocale(acceptLanguage: string | null): AppLanguage {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const preferred = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.split(";").map((p) => p.trim());
      const q = params.find((p) => p.startsWith("q="));
      return { lang: tag.split("-")[0]!.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter(({ q }) => q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of preferred) if (isAppLanguage(lang)) return lang;
  return DEFAULT_LOCALE;
}

/**
 * The portal's language: the signed-in staff member's setting, or before
 * signing in (the login page) the browser's.
 */
export function resolveLocale(userLanguage: string | undefined, acceptLanguage: string | null): AppLanguage {
  return isAppLanguage(userLanguage) ? userLanguage : preferredLocale(acceptLanguage);
}
