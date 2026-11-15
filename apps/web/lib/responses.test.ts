import { describe, expect, it } from "vitest";
import { apiJson, fileResponse, noContent, withApiPolicy } from "./responses";
import { API_PAGE_CSP, FILE_CSP, JSON_CSP, PDF_CSP } from "./security-headers.js";

const pdf = () => ({
  filename: "Presupuesto Rev.1 — Caviedes.pdf",
  contentType: "application/pdf",
  sizeBytes: 4,
  body: new Blob(["%PDF"]).stream(),
});

describe("apiJson", () => {
  it("answers the JSON as before, with the locked-down policy", async () => {
    const res = apiJson({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe(JSON_CSP);
  });

  it("answers 200 by default", () => {
    expect(apiJson([]).status).toBe(200);
  });
});

describe("noContent", () => {
  it("is an empty 204 with the JSON policy", async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("content-security-policy")).toBe(JSON_CSP);
  });
});

describe("withApiPolicy", () => {
  it("adds the JSON policy to every answer of a handler, keeping its status, body and cookies", async () => {
    const handler = withApiPolicy(async (request: Request) => {
      const headers = new Headers({ location: new URL("/dashboard", request.url).href });
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return new Response("moved", { status: 302, headers });
    });

    const res = await handler(new Request("http://localhost/api/auth/callback/credentials"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(await res.text()).toBe("moved");
    expect(res.headers.get("content-security-policy")).toBe(JSON_CSP);
  });

  it("gives a plain HTML page its inline styles and form, nothing else", async () => {
    const page = await withApiPolicy(async () => new Response("<style>p{}</style>", { headers: { "content-type": "text/html" } }))();
    expect(page.headers.get("content-security-policy")).toBe(API_PAGE_CSP);
    expect(API_PAGE_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  });

  it("copies an answer whose headers can't be changed (Response.redirect's)", async () => {
    const res = await withApiPolicy(async () => Response.redirect("http://localhost/", 302))();
    expect(res.headers.get("content-security-policy")).toBe(JSON_CSP);
    expect(res.headers.get("location")).toBe("http://localhost/");
  });
});

describe("fileResponse", () => {
  it("opens a PDF in the browser's viewer, framed by the portal only, with nothing else in its policy", async () => {
    const res = fileResponse(pdf());

    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe("4");
    expect(res.headers.get("content-disposition")).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent("Presupuesto Rev.1 — Caviedes.pdf")}`,
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // No default-src: it would reach the PDF viewer (Safari's, Firefox's).
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(PDF_CSP).toBe("frame-ancestors 'self'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("%PDF");
  });

  it.each(["application/pdf", "Application/PDF", "application/pdf; charset=binary"])("knows a PDF by its type: %s", (contentType) => {
    expect(fileResponse({ ...pdf(), contentType }).headers.get("content-security-policy")).toBe(PDF_CSP);
  });

  it.each([
    ["a photo", "image/jpeg", "foto.jpg", false],
    ["a thumbnail", "image/webp", "foto.webp", false],
    ["a PNG", "image/png", "plano.png", false],
    ["an attachment", "application/octet-stream", "acta.bin", true],
    ["a text file downloaded", "text/plain", "notas.txt", true],
  ])("lets %s load nothing, framed by the portal only", (_, contentType, filename, download) => {
    const res = fileResponse({ filename, contentType, sizeBytes: 2, body: new Blob(["xx"]).stream() }, { download, immutable: true });

    expect(res.headers.get("content-security-policy")).toBe(FILE_CSP);
    expect(FILE_CSP).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(download ? /^attachment;/ : /^inline;/);
  });

  it("downloads a PDF as an attachment with the PDF's policy all the same", () => {
    const res = fileResponse(pdf(), { download: true });
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-security-policy")).toBe(PDF_CSP);
  });

  it("saves a download, and lets an immutable file stay in the caller's cache for a day", () => {
    const zip = { filename: "dossier.zip", contentType: "application/zip", body: new Blob(["PK"]).stream() };
    const res = fileResponse(zip, { download: true, immutable: true });

    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''dossier.zip");
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(res.headers.get("content-security-policy")).toBe(FILE_CSP);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
