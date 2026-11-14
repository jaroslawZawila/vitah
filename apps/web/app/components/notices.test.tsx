// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import AppError from "../error";
import DashboardError from "../dashboard/error";
import ForbiddenPage from "../dashboard/forbidden/page";
import DashboardLoading from "../dashboard/loading";
import DashboardNotFound from "../dashboard/not-found";
import NotFound from "../not-found";
import UnavailableNotice from "./UnavailableNotice";

// The pages a visitor meets when something goes wrong: translated, with the
// digest to quote to support, and never the error's own message.

const MESSAGES = { es, en };
type Locale = keyof typeof MESSAGES;

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const server = vi.hoisted(() => ({ locale: "es" as "es" | "en" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: server.locale, messages: MESSAGES[server.locale] as typeof es, namespace: namespace as "errorPages" }),
}));

const SECRET = 'relation "users" does not exist: select * from users where email = ana@vitah.es';
const failure = (digest?: string) => Object.assign(new Error(SECRET), digest ? { digest } : {});

function renderIn(locale: Locale, ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** A server component's output, its async children awaited as the server would. */
async function resolved(node: React.ReactNode | Promise<React.ReactNode>): Promise<React.ReactNode> {
  const element = await node;
  if (isValidElement(element) && typeof element.type === "function") {
    return resolved((element.type as (props: unknown) => React.ReactNode | Promise<React.ReactNode>)(element.props));
  }
  return element;
}

async function renderServer(locale: Locale, component: () => React.ReactNode | Promise<React.ReactNode>) {
  server.locale = locale;
  return renderIn(locale, await resolved(component()));
}

beforeEach(() => router.refresh.mockClear());

describe("the dashboard's error page", () => {
  it("says what happened in Spanish, with the digest and never the error's message", () => {
    const { container } = renderIn("es", <DashboardError error={failure("2948571036")} reset={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Algo ha fallado" })).toBeInTheDocument();
    expect(screen.getByText(/No hemos podido cargar esta página/)).toBeInTheDocument();
    expect(screen.getByText("2948571036")).toBeInTheDocument();
    expect(screen.getByText(/Código del error/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute("href", "/dashboard/projects");
    expect(container.textContent).not.toContain("users");
    expect(container.textContent).not.toContain("ana@vitah.es");
    // In the workspace, beside the rail: not a page of its own.
    expect(container.querySelector("main")).toBeNull();
  });

  it("says it in English", () => {
    const { container } = renderIn("en", <DashboardError error={failure("77")} reset={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText(/Error code/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Projects" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("users");
  });

  it("asks the server again and clears the error on \"Reintentar\"", () => {
    const reset = vi.fn();
    renderIn("es", <DashboardError error={failure("1")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows no code when the error has none (thrown in the browser)", () => {
    const { container } = renderIn("es", <DashboardError error={failure()} reset={vi.fn()} />);

    expect(screen.queryByText(/Código del error/)).toBeNull();
    expect(container.textContent).not.toContain("users");
  });
});

describe("the error page outside the dashboard", () => {
  it("is a page of its own, with the same message, digest and silence about the error", () => {
    const { container } = renderIn("es", <AppError error={failure("555000")} reset={vi.fn()} />);

    expect(container.querySelector("main")).not.toBeNull();
    expect(screen.getByText("ViTAH")).toBeInTheDocument();
    expect(screen.getByText("TECNOLOGÍA PARA VIVIR MEJOR")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Algo ha fallado" })).toBeInTheDocument();
    expect(screen.getByText("555000")).toBeInTheDocument();
    expect(container.textContent).not.toContain("users");
  });
});

describe("\"No encontrado\"", () => {
  it("says the record doesn't exist, was deleted or isn't the visitor's to see, with the way back", async () => {
    const { container } = await renderServer("es", DashboardNotFound);

    expect(screen.getByRole("heading", { level: 1, name: "No encontrado" })).toBeInTheDocument();
    expect(screen.getByText("Lo que buscas no existe, se ha eliminado o no tienes acceso.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute("href", "/dashboard/projects");
    expect(container.querySelector("main")).toBeNull();
  });

  it("is translated, and a page of its own outside the dashboard", async () => {
    const { container } = await renderServer("en", NotFound);

    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByText(/doesn't exist, was deleted, or you don't have access/)).toBeInTheDocument();
    expect(screen.getByText("TECHNOLOGY FOR BETTER LIVING")).toBeInTheDocument();
    expect(container.querySelector("main")).not.toBeNull();
  });
});

describe("\"No tienes permiso\"", () => {
  it("says so in both languages", async () => {
    const spanish = await renderServer("es", ForbiddenPage);
    expect(screen.getByRole("heading", { level: 1, name: "No tienes permiso" })).toBeInTheDocument();
    expect(screen.getByText(/pide acceso a un administrador/)).toBeInTheDocument();
    spanish.unmount();

    await renderServer("en", () => UnavailableNotice({ kind: "forbidden" }));
    expect(screen.getByRole("heading", { level: 1, name: "You don't have permission" })).toBeInTheDocument();
  });
});

describe("the dashboard's loading state", () => {
  it("is a quiet outline that tells a screen reader the page is loading", () => {
    renderIn("es", <DashboardLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Cargando…");
    // No spinner, and nothing but the label for assistive technology.
    expect(status.querySelector("svg")).toBeNull();
    expect(status.querySelector("[aria-hidden]")).not.toBeNull();
  });
});
