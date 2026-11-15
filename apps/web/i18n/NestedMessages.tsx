"use client";

import { useMemo } from "react";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import { mergeMessages, type Messages } from "./merge-messages";

/**
 * A layout's own translations added to those of the layouts above it, in the browser: the
 * server sends each level's part once, and moving to another page re-sends only the levels
 * that page renders anew. The locale is passed on; the time zone, `now`, formats and error
 * handling are inherited from the provider above.
 */
export default function NestedMessages({ messages, children }: { messages: Messages; children: React.ReactNode }) {
  const locale = useLocale();
  const above = useMessages();
  // Kept between renders, so the components below re-render only when the messages change.
  const merged = useMemo(() => mergeMessages(above, messages), [above, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}
