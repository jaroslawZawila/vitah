// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workerAccess, type WorkerListItem, type WorkersPage } from "@repo/core/contract";
import messages from "../../../../messages/es.json";
import WorkersScreen, { type WorkersQuery } from "./WorkersScreen";

// The list's filters live in the URL: the screen replaces it and the server renders the page again.
const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/dashboard/subcontratas/trabajadores",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("../../../actions/subcontractors", () => ({ checkWorkerAccessAction: vi.fn() }));

const worker = (id: string, firstName: string, surnames: string): WorkerListItem => ({
  id,
  subcontractorId: "c-1",
  subcontractorName: "Cubiertas Besaya S.L.",
  subcontractorKind: "company",
  firstName,
  surnames,
  idDocumentMasked: "72•••018Z",
  trade: "roofing",
  category: "officer_1",
  roles: [],
  docs: {},
  access: workerAccess({ company: "apta", docs: new Map(), roles: [], today: "2026-10-17" }),
});

const page: WorkersPage = {
  workers: [worker("w-1", "Marcos", "Revuelta Gil"), worker("w-2", "Sergio", "Sainz Abascal")],
  paging: { page: 2, limit: 50, total: 120, pages: 3 },
  counts: { all: 180, ok: 50, pending: 120, blocked: 10 },
  summary: { registered: 1200, companies: 120, ok: 900, pending: 250, blocked: 50, preventive: 93 },
};
const NO_QUERY: WorkersQuery = { projectId: "", access: "all", companyId: "", query: "" };

function renderScreen(query: Partial<WorkersQuery> = {}, search = "", shown = page) {
  navigation.search = search;
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <WorkersScreen
        page={shown}
        projects={[{ id: "p-1", ref: "VTH-26-001", address: "Caviedes", obraStage: 6, chapters: [] }]}
        companies={[{ id: "c-1", legalName: "Cubiertas Besaya S.L." }]}
        query={{ ...NO_QUERY, ...query }}
        canManage
      />
    </NextIntlClientProvider>,
  );
}

const replaced = () => navigation.replace.mock.lastCall?.[0];
beforeEach(() => navigation.replace.mockReset());

describe("WorkersScreen", () => {
  it("shows the page of workers with the whole list's KPIs and counts", () => {
    renderScreen({ access: "pending" }, "acceso=pending&page=2");

    // Every worker registered, whatever page and filter are shown.
    const tile = (name: string) => screen.getByText(name).parentElement!;
    expect(tile("Registrados")).toHaveTextContent("1200");
    expect(tile("Registrados")).toHaveTextContent("en 120 empresas");
    expect(tile("Recursos preventivos")).toHaveTextContent("93");
    // The filters keep 120 of the 1.200; this page shows two of them.
    expect(screen.getByText("Mostrando 120 de 1200")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    const filters = within(screen.getByRole("group", { name: "Acceso" }));
    expect(filters.getByRole("button", { name: /Pendientes/ })).toHaveTextContent("120");
    expect(filters.getByRole("button", { name: /Todos/ })).toHaveTextContent("180");

    const pager = within(screen.getByRole("navigation", { name: "Páginas" }));
    expect(pager.getByText("51–100 de 120")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/dashboard/subcontratas/trabajadores?acceso=pending");
    expect(pager.getByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/dashboard/subcontratas/trabajadores?acceso=pending&page=3");
  });

  it("shows the filters of the URL", () => {
    renderScreen({ projectId: "p-1", companyId: "c-1", query: "sainz" }, "obra=p-1&empresa=c-1&q=sainz");
    expect(screen.getByLabelText("Obra")).toHaveValue("p-1");
    expect(screen.getByLabelText("Empresa")).toHaveValue("c-1");
    expect(screen.getByLabelText("Buscar nombre o empresa")).toHaveValue("sainz");
  });

  it("puts each filter in the URL, back on the first page", async () => {
    renderScreen({}, "page=3");

    await userEvent.click(within(screen.getByRole("group", { name: "Acceso" })).getByRole("button", { name: /Bloqueados/ }));
    expect(replaced()).toBe("/dashboard/subcontratas/trabajadores?acceso=blocked");
    await userEvent.selectOptions(screen.getByLabelText("Empresa"), "c-1");
    expect(replaced()).toBe("/dashboard/subcontratas/trabajadores?empresa=c-1");
    await userEvent.selectOptions(screen.getByLabelText("Obra"), "p-1");
    expect(replaced()).toBe("/dashboard/subcontratas/trabajadores?obra=p-1");
    navigation.replace.mockClear();
    await userEvent.type(screen.getByLabelText("Buscar nombre o empresa"), "sainz");
    await waitFor(() => expect(replaced()).toBe("/dashboard/subcontratas/trabajadores?q=sainz"));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it("has no pager when one page holds every worker, and says so when none match", () => {
    const { unmount } = renderScreen({}, "", { ...page, paging: { page: 1, limit: 50, total: 2, pages: 1 } });
    expect(screen.queryByRole("navigation", { name: "Páginas" })).not.toBeInTheDocument();
    unmount();

    renderScreen({ query: "nadie" }, "q=nadie", { ...page, workers: [], paging: { page: 1, limit: 50, total: 0, pages: 1 } });
    expect(screen.getByText("No hay trabajadores con estos filtros.")).toBeInTheDocument();
    expect(screen.getByText("Mostrando 0 de 1200")).toBeInTheDocument();
  });
});
