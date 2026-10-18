// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import BackLink, { canGoBack, NavigationTracker, resetVisited } from "./BackLink";

const navigation = { pathname: "/dashboard/compras" };
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

const ORDER = "/dashboard/projects/p-1/compras/o-1";

function Page() {
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      <NavigationTracker />
      <BackLink href="/dashboard/projects/p-1/compras" />
    </NextIntlClientProvider>
  );
}

/** Visits each path in turn, as the app router would. */
function visit(...paths: string[]) {
  const [first, ...rest] = paths;
  navigation.pathname = first!;
  const view = render(<Page />);
  for (const path of rest) {
    navigation.pathname = path;
    view.rerender(<Page />);
  }
}

describe("BackLink", () => {
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  beforeEach(() => resetVisited());
  afterEach(() => back.mockClear());

  it("goes back to the page it was opened from", () => {
    visit("/dashboard/compras", ORDER);

    const link = screen.getByRole("link", { name: "← Volver" });
    expect(link).toHaveAttribute("href", "/dashboard/projects/p-1/compras");
    expect(link).toHaveAttribute("data-back-link"); // hides the project layout's "Volver a proyectos"
    expect(fireEvent.click(link)).toBe(false); // the link itself is not followed
    expect(back).toHaveBeenCalledOnce();
  });

  it("follows its link when opened straight from a URL", () => {
    visit(ORDER);

    expect(fireEvent.click(screen.getByRole("link", { name: "← Volver" }))).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });

  it("leaves ⌘-click to the browser", () => {
    visit("/dashboard/compras", ORDER);

    expect(fireEvent.click(screen.getByRole("link", { name: "← Volver" }), { metaKey: true })).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });

  it("counts going back as leaving the page, not as a new one", () => {
    // Opened on the order, to its form and back: nothing in the portal before the order.
    visit(ORDER, `${ORDER}/editar`, ORDER);
    expect(canGoBack()).toBe(false);
  });
});
