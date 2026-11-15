import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { scopeMessages, type MessageScope } from "./client-messages";
import NestedMessages from "./NestedMessages";

/**
 * The translations a layout's client components may use (i18n/client-messages.ts), in the
 * request's language. A layout wraps everything it renders in it, with its own folder as `scope`.
 * The root level sets up next-intl in the browser (locale, time zone…); a level below sends only
 * what it adds, which the browser lays over the messages above.
 */
export default async function ClientMessages({ scope, children }: { scope: MessageScope; children: React.ReactNode }) {
  const messages = scopeMessages(await getMessages(), scope);
  if (scope === "") return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
  return <NestedMessages messages={messages}>{children}</NestedMessages>;
}
