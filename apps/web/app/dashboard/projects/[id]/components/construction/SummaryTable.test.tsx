// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../../../messages/en.json";
import es from "../../../../../../messages/es.json";
import { TODAY, controlChapter } from "../../../../../../test/construction-fixture";
import { SchedulePill } from "./SummaryTable";

// A pending chapter whose planned start passed 249 days ago.
const late = controlChapter({ state: "pending", plannedStart: "2026-02-10", actualStart: null, actualEnd: null });

function renderPill(long: boolean, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <SchedulePill chapter={late} today={TODAY} long={long} />
    </NextIntlClientProvider>,
  );
}

describe("SchedulePill", () => {
  it("says a passed start short in the table, so the Plazo column fits the card", () => {
    renderPill(false);
    expect(screen.getByText("Inicio superado +249 d")).toBeInTheDocument();
  });

  it("says it in full on the chapter's page", () => {
    renderPill(true);
    expect(screen.getByText("Inicio previsto superado · +249 d")).toBeInTheDocument();
  });

  it("in English too", () => {
    renderPill(false, "en");
    expect(screen.getByText("Start passed +249 d")).toBeInTheDocument();
  });
});
