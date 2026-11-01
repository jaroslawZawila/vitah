// @vitest-environment jsdom
import { Suspense } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { budgetsOverview } from "../../../../../../test/budgets-fixture";
import BudgetObraNav from "./BudgetObraNav";

const router = { push: vi.fn() };
const navigation = { pathname: "/dashboard/projects/p-2/budget/lines", search: "chapter=06&revision=r-old" };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => router.push.mockClear());

/** Both variants, as the budget layout mounts them, once the overview has come. */
async function renderNav(currentId = "p-2", items = budgetsOverview.items) {
  const overview = Promise.resolve({ ...budgetsOverview, items });
  await act(async () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages}>
        <Suspense>
          <BudgetObraNav overview={overview} currentId={currentId} variant="list" />
          <BudgetObraNav overview={overview} currentId={currentId} variant="bar" />
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
}

const list = () => within(screen.getByRole("navigation", { name: "Obras" }));

describe("BudgetObraNav", () => {
  it("lists the obras beside the budget, each opening the same page of theirs", async () => {
    await renderNav();
    const current = list().getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("VTH-26-002");
    expect(current).toHaveTextContent("Vence en 5 días");
    // The tab and chapter go along; the revision is the other obra's own.
    expect(list().getByRole("link", { name: /VTH-26-001/ })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/lines?chapter=06");
    expect(list().getByRole("link", { name: /VTH-26-003/ })).toHaveTextContent("€/m² alto");
    expect(list().getByRole("link", { name: /VTH-26-004/ })).toHaveTextContent("IA en marcha");
    expect(list().getByText("2 de 5")).toBeInTheDocument();
    expect(list().getByRole("link", { name: "Obra anterior" })).toHaveAttribute("href", "/dashboard/projects/p-3/budget/lines?chapter=06");
    expect(list().getByRole("link", { name: "Obra anterior" })).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp");
    expect(list().getByRole("link", { name: "Obra siguiente" })).toHaveAttribute("href", "/dashboard/projects/p-4/budget/lines?chapter=06");
  });

  it("goes round from the last obra to the first", async () => {
    await renderNav("p-5");
    expect(list().getByRole("link", { name: "Obra siguiente" })).toHaveAttribute("href", "/dashboard/projects/p-3/budget/lines?chapter=06");
  });

  it("filters the list as it is typed into", async () => {
    await renderNav();
    const search = list().getByRole("searchbox", { name: "Buscar obra" });
    await userEvent.type(search, "caviedes");
    expect(list().getAllByRole("link", { name: /^VTH/ }).map((l) => l.getAttribute("href"))).toEqual([
      "/dashboard/projects/p-1/budget/lines?chapter=06",
    ]);
    await userEvent.clear(search);
    await userEvent.type(search, "zaragoza");
    expect(list().getByText("Ninguna obra coincide.")).toBeInTheDocument();
  });

  it("moves to the obra after or before with Alt+↓ / Alt+↑, not while typing", async () => {
    await renderNav();
    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    expect(router.push).toHaveBeenLastCalledWith("/dashboard/projects/p-4/budget/lines?chapter=06");
    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    expect(router.push).toHaveBeenLastCalledWith("/dashboard/projects/p-3/budget/lines?chapter=06");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(list().getByRole("searchbox"), { key: "ArrowDown", altKey: true });
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it("picks any obra from the bar on narrower screens", async () => {
    await renderNav();
    await userEvent.type(screen.getByRole("combobox"), "ribamontán");
    await userEvent.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-5/budget/lines?chapter=06");
  });

  it("has nowhere to step to with a single obra", async () => {
    await renderNav("p-2", budgetsOverview.items.filter((i) => i.projectId === "p-2"));
    expect(list().getByRole("link", { current: "page" })).toHaveTextContent("VTH-26-002");
    expect(screen.queryByRole("link", { name: "Obra siguiente" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows nothing for an obra not in the list", async () => {
    await renderNav("p-other");
    expect(screen.queryByRole("navigation", { name: "Obras" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
