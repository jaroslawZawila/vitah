// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../messages/es.json";
import BudgetPdfScreen from "./BudgetPdfScreen";

const renderScreen = (draft: boolean) =>
  render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <BudgetPdfScreen
        backHref="/dashboard/projects/p-1/budget"
        hrefs={{ general: "/b/pdf?kind=general", detailed: "/b/pdf?kind=detailed" }}
        fileUrl="/api/v1/projects/p-1/budget/revisions/rev-1/pdf?kind=detailed"
        kind="detailed"
        draft={draft}
      />
    </NextIntlClientProvider>,
  );

describe("BudgetPdfScreen", () => {
  it("shows the chosen PDF with the switch and a download", () => {
    renderScreen(true);

    expect(screen.getByTitle("PDF detallado")).toHaveAttribute("src", "/api/v1/projects/p-1/budget/revisions/rev-1/pdf?kind=detailed");
    expect(screen.getByRole("tab", { name: "PDF detallado" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "PDF general" })).toHaveAttribute("href", "/b/pdf?kind=general");
    expect(screen.getByRole("link", { name: "Descargar PDF" })).toHaveAttribute("download");
    expect(screen.getByText(/Borrador: lleva la marca/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver al presupuesto/ })).toHaveAttribute("href", "/dashboard/projects/p-1/budget");
  });

  it("says an issued PDF is what the client got", () => {
    renderScreen(false);
    expect(screen.getByText("Lo que se envió al cliente")).toBeInTheDocument();
  });
});
