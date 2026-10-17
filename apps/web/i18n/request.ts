import { usersService } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";
import { resolveLocale } from "./locale";

/** The signed-in staff member's language setting, read fresh: a change shows at once. */
async function userLanguage() {
  const ctx = await getSessionContext();
  if (!ctx) return undefined;
  try {
    return (await usersService.getMe(ctx)).language ?? undefined;
  } catch (error) {
    // The page still renders, in the browser's language.
    console.error(error);
    return undefined;
  }
}

export default getRequestConfig(async () => {
  const [language, reqHeaders] = await Promise.all([userLanguage(), headers()]);
  const locale = resolveLocale(language, reqHeaders.get("accept-language"));

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
