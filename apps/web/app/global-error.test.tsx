// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

// The root layout failed: no providers, so the page carries its own two
// languages and picks by the browser's.

const SECRET = "connect ECONNREFUSED 10.0.0.5:5432 (user vitah)";
const failure = Object.assign(new Error(SECRET), { digest: "81200431" });

function browserSpeaks(...languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

afterEach(() => vi.restoreAllMocks());

describe("global error", () => {
  it("renders its own document on the server, in Spanish, with the digest and not the error's message", () => {
    const html = renderToString(<GlobalError error={failure} />);

    expect(html).toMatch(/^<html lang="es">/);
    expect(html).toContain("<body>");
    expect(html).toContain("Algo ha fallado");
    expect(html).toContain("Reintentar");
    expect(html).toContain("81200431");
    expect(html).not.toContain("ECONNREFUSED");
    expect(html).not.toContain("10.0.0.5");
  });

  it("speaks English to a browser that prefers it", () => {
    browserSpeaks("en-GB", "es");
    // React logs that <html> can't sit inside the test's <div>; in the app it is the document.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<GlobalError error={failure} />);

    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("81200431")).toBeInTheDocument();
    expect(document.documentElement.textContent).not.toContain("ECONNREFUSED");
  });

  it("speaks Spanish to one that prefers it, or neither", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    browserSpeaks("de-DE", "es-ES", "en");
    const first = render(<GlobalError error={failure} />);
    expect(screen.getByRole("heading", { level: 1, name: "Algo ha fallado" })).toBeInTheDocument();
    first.unmount();

    browserSpeaks("fr-FR");
    render(<GlobalError error={failure} />);
    expect(screen.getByRole("heading", { level: 1, name: "Algo ha fallado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute("href", "/dashboard/projects");
  });
});
