// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../messages/es.json";
import ObraFrame from "./ObraFrame";

function renderFrame(aside?: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ObraFrame
        projectId="p-1"
        header={{ ref: "VTH-26-001", stage: 6, openIssues: 3 }}
        current="photos"
        title="Fotos de obra"
        description="Polígono 501, Valdáliga"
        aside={aside}
      >
        <p>Contenido</p>
      </ObraFrame>
    </NextIntlClientProvider>,
  );
}

describe("ObraFrame", () => {
  it("heads the page with the ref, stage, title and what it is for, above the Obra tabs", () => {
    renderFrame(<dl aria-label="Datos" />);
    expect(screen.getByText("VTH-26-001")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Fotos de obra" })).toBeInTheDocument();
    expect(screen.getByText("Polígono 501, Valdáliga")).toBeInTheDocument();

    const tabs = within(screen.getByRole("navigation", { name: "Secciones de obra" }));
    expect(tabs.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard/projects/p-1/obra",
      "/dashboard/projects/p-1/obra/planificacion",
      "/dashboard/projects/p-1/obra/avance",
      "/dashboard/projects/p-1/obra/costes",
      "/dashboard/projects/p-1/obra/hitos",
      "/dashboard/projects/p-1/obra/incidencias",
      "/dashboard/projects/p-1/obra/fotos",
    ]);
    expect(tabs.getByRole("link", { current: "page" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/fotos");
    expect(tabs.getByRole("link", { name: /Incidencias/ })).toHaveTextContent("Incidencias3 abiertas");
  });

  it("keeps the open issues' screen-reader text inside the tab strip, so it can't widen the page", () => {
    renderFrame();
    const nav = screen.getByRole("navigation", { name: "Secciones de obra" });
    // `sr-only` is absolute: the strip that scrolls must be its containing block to clip it.
    expect(nav).toHaveClass("relative", "overflow-x-auto");
    expect(within(nav).getByText(/abiertas/)).toHaveClass("sr-only");
  });

  it("puts the tabs straight after the title on a phone, and the aside after them", () => {
    renderFrame(<dl aria-label="Datos" />);
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    const nav = screen.getByRole("navigation", { name: "Secciones de obra" });
    // The header gives way below `sm`, so its title block and its aside are ordered on their own.
    expect(header).toHaveClass("max-sm:contents");
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveClass("max-sm:-order-1");
    expect(nav).toHaveClass("max-sm:-order-1");
    const aside = screen.getByLabelText("Datos");
    expect(aside.parentElement).toBe(header);
    expect(aside).not.toHaveClass("max-sm:-order-1");
  });
});
