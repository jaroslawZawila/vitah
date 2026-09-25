// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/es.json";
import ProjectsListClient from "./ProjectsListClient";

const projects = [
  {
    id: "p1",
    ref: "VTH-1",
    address: "Calle Mayor 1, Santander",
    startDate: new Date("2026-03-01T00:00:00Z"),
    completionDate: null,
    client: { id: "c1", name: "Ana García", email: "ana@example.com" },
  },
  {
    id: "p2",
    ref: "VTH-2",
    address: "Calle del Sol 5, Santander",
    startDate: null,
    completionDate: null,
    client: null,
  },
];

function renderList(list = projects) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <ProjectsListClient projects={list} />
    </NextIntlClientProvider>,
  );
}

describe("ProjectsListClient", () => {
  it("lists projects with their address, client and dates", () => {
    renderList();

    expect(screen.getByText("Todos (2)")).toBeInTheDocument();
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first!).getByText("VTH-1")).toBeInTheDocument();
    expect(
      within(first!).getByText("Calle Mayor 1, Santander"),
    ).toBeInTheDocument();
    expect(within(first!).getByText("Ana García")).toBeInTheDocument();
    expect(within(first!).getByText("1 mar 2026")).toBeInTheDocument();
    expect(within(first!).getByRole("link", { name: "Ver" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p1",
    );
    expect(
      within(second!).getByText("Sin acceso a la app"),
    ).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderList([]);

    expect(screen.getByText("Todavía no hay proyectos.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("links to the new-project flow", () => {
    renderList();

    expect(screen.getByRole("link", { name: "+ Nuevo Proyecto" })).toHaveAttribute(
      "href",
      "/dashboard/projects/new",
    );
  });
});
