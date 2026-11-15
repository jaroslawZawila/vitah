// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { PurchaseOrderEvent } from "@repo/core/contract";
import en from "../../../../../../messages/en.json";
import es from "../../../../../../messages/es.json";
import { EventText } from "./OrderViews";

const event = (action: string, detail: Record<string, unknown> = {}): PurchaseOrderEvent => ({
  id: "ev-1",
  action,
  detail,
  note: null,
  by: "Laura Pérez",
  at: "2026-10-06T10:00:00.000Z",
});

function textOf(e: PurchaseOrderEvent, locale: "es" | "en" = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <EventText event={e} />
    </NextIntlClientProvider>,
  );
  return container.textContent;
}

describe("EventText", () => {
  it("never shows a code: an action this build doesn't know is said in words", () => {
    expect(textOf(event("merged_into"))).toBe("Cambio registrado");
    expect(textOf(event("merged_into"), "en")).toBe("Change recorded");
  });

  it("names a field it doesn't know as another field, not by its key", () => {
    const text = textOf(event("updated", { fields: { futureField: { from: "a", to: "b" } } }));
    expect(text).toBe("Otro dato: a → b");
    expect(text).not.toContain("futureField");
  });
});
