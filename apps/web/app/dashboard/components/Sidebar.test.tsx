// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import Sidebar from "./Sidebar";

const navigation = { pathname: "/dashboard/projects", params: {} as { id?: string } };
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useParams: () => navigation.params,
}));

/** Next only sets `id` on `projects/[id]` routes. */
function renderAt(pathname: string, isAdmin = true) {
  navigation.pathname = pathname;
  navigation.params = /^\/dashboard\/projects\/(?!new$)[^/]+/.test(pathname)
    ? { id: pathname.split("/")[3] }
    : {};
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <Sidebar name="Laura" email="laura@vitah.es" isAdmin={isAdmin} />
    </NextIntlClientProvider>,
  );
}

const projectTabs = () => screen.queryByRole("list", { name: "Secciones del proyecto" });

describe("Sidebar", () => {
  it("shows the main sections, admin ones only to admins", () => {
    renderAt("/dashboard/projects", false);

    expect(screen.getByRole("link", { name: /Proyectos/ })).toHaveAttribute(
      "href",
      "/dashboard/projects",
    );
    expect(screen.queryByRole("link", { name: /Clientes/ })).not.toBeInTheDocument();
  });

  it("has no project tabs outside a project", () => {
    renderAt("/dashboard/projects");
    expect(projectTabs()).not.toBeInTheDocument();
  });

  it("has no project tabs on the new-project wizard", () => {
    renderAt("/dashboard/projects/new");
    expect(projectTabs()).not.toBeInTheDocument();
  });

  it.each([
    ["/dashboard/projects/p-1", "General"],
    ["/dashboard/projects/p-1/documents", "Documentos"],
    ["/dashboard/projects/p-1/photos", "Fotos"],
  ])("opens the project's tabs on %s", (pathname, current) => {
    renderAt(pathname);

    const tabs = within(projectTabs()!);
    expect(tabs.getByRole("link", { name: "General" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1",
    );
    expect(tabs.getByRole("link", { name: "Documentos" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/documents",
    );
    expect(tabs.getByRole("link", { name: "Fotos" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/photos",
    );
    expect(tabs.getByRole("link", { current: "page" })).toHaveTextContent(current);
  });
});
