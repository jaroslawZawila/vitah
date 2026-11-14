import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreError } from "@repo/core";

vi.mock("@repo/auth/context", () => ({ getRequestContext: vi.fn() }));
vi.mock("@repo/auth/mobile", () => ({ authenticateMobileRequest: vi.fn() }));
const { getRequestContext } = await import("@repo/auth/context");
const { authenticateMobileRequest } = await import("@repo/auth/mobile");
const { isCrossSiteWrite, readCreate, readWithFile, withContext, withMobileClient } = await import("./api");

afterEach(() => vi.restoreAllMocks());

function request(method: string, headers: Record<string, string>) {
  return new Request("http://portal.vitah.es/api/v1/users", {
    method,
    headers: { host: "portal.vitah.es", ...headers },
  });
}

describe("isCrossSiteWrite", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses a %s from another origin", (method) => {
    expect(isCrossSiteWrite(request(method, { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(request(method, { origin: "https://shop.vitah.es" }))).toBe(true);
    expect(isCrossSiteWrite(request(method, { origin: "null" }))).toBe(true);
  });

  it("allows the portal's own origin, reads, Bearer calls and non-browser clients", () => {
    expect(isCrossSiteWrite(request("POST", { origin: "https://portal.vitah.es" }))).toBe(false);
    expect(isCrossSiteWrite(request("GET", { origin: "https://evil.example" }))).toBe(false);
    expect(
      isCrossSiteWrite(
        request("POST", { origin: "https://evil.example", authorization: "Bearer x" }),
      ),
    ).toBe(false);
    expect(isCrossSiteWrite(request("POST", {}))).toBe(false);
  });

  it("checks cookie calls that carry some other Authorization header", () => {
    expect(
      isCrossSiteWrite(
        request("POST", { origin: "https://evil.example", authorization: "Basic abc" }),
      ),
    ).toBe(true);
  });

  it("compares with the forwarded host behind a proxy", () => {
    expect(
      isCrossSiteWrite(
        request("POST", {
          host: "internal:3000",
          "x-forwarded-host": "portal.vitah.es",
          origin: "https://portal.vitah.es",
        }),
      ),
    ).toBe(false);
  });
});

describe("withContext", () => {
  it("answers 403 to a cross-site write without running the handler", async () => {
    const handler = vi.fn();

    const res = await withContext(request("POST", { origin: "https://evil.example" }), handler);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getRequestContext).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers an expected failure with its code and status, without logging", async () => {
    vi.mocked(getRequestContext).mockResolvedValue({ tenantId: "t1", userId: "u1", role: "manager" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await withContext(request("GET", {}), async () => {
      throw new CoreError("not_found", 404);
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(log).not.toHaveBeenCalled();
  });

  it("answers an unexpected error with internal_error and an id, logged once with the route", async () => {
    vi.mocked(getRequestContext).mockResolvedValue({ tenantId: "t1", userId: "u1", role: "manager" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = new Request("http://portal.vitah.es/api/v1/projects/p1/obra/control?debug=1&email=ana@vitah.es", {
      method: "PATCH",
      headers: { host: "portal.vitah.es", authorization: "Bearer SECRET", cookie: "authjs.session-token=SECRET" },
    });

    const res = await withContext(failing, async () => {
      throw new TypeError("relation \"projects\" does not exist");
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    // `error` as before (installed apps read it), plus the id to quote.
    expect(body).toEqual({ error: "internal_error", id: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(log).toHaveBeenCalledTimes(1);
    const text = log.mock.calls[0]![0] as string;
    expect(JSON.parse(text)).toMatchObject({
      level: "error",
      event: "api.internal_error",
      id: body.id,
      method: "PATCH",
      path: "/api/v1/projects/p1/obra/control",
      error: { name: "TypeError", message: 'relation "projects" does not exist' },
    });
    // Nothing of the request but its method and path; nothing of the error in the answer.
    expect(text).not.toMatch(/SECRET|debug|ana@/);
    expect(JSON.stringify(body)).not.toContain("projects");
  });
});

describe("withMobileClient", () => {
  it("answers an unexpected error the same way: an id in the answer and one log line", async () => {
    vi.mocked(authenticateMobileRequest).mockResolvedValue({ sub: "c1", email: "cliente@vitah.es", name: null, role: "client", tenantId: "t1" } as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await withMobileClient(new Request("http://portal.vitah.es/api/mobile/obra?projectId=p1"), async () => {
      throw new Error("boom");
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal_error", id: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: "api.internal_error", id: body.id, method: "GET", path: "/api/mobile/obra" });
    expect(log.mock.calls[0]![0]).not.toContain("cliente@vitah.es");
  });
});

describe("readCreate", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://portal.vitah.es/api/v1/purchases/o1/invoices", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("puts the Idempotency-Key header in the body for core, over the body's own field", async () => {
    expect(await readCreate(post({ amountCents: 5 }, { "Idempotency-Key": "key-from-the-header" }))).toEqual({
      amountCents: 5,
      idempotencyKey: "key-from-the-header",
    });
    expect(await readCreate(post({ amountCents: 5, idempotencyKey: "key-from-the-body" }, { "idempotency-key": "key-from-the-header" }))).toEqual({
      amountCents: 5,
      idempotencyKey: "key-from-the-header",
    });
    // An empty header is a key that isn't one, for core to refuse: not "no key".
    expect(await readCreate(post({ amountCents: 5 }, { "Idempotency-Key": "" }))).toEqual({ amountCents: 5, idempotencyKey: "" });
  });

  it("leaves the body as it came without the header: its own field, or no key", async () => {
    expect(await readCreate(post({ amountCents: 5, idempotencyKey: "key-from-the-body" }))).toEqual({ amountCents: 5, idempotencyKey: "key-from-the-body" });
    expect(await readCreate(post({ amountCents: 5 }))).toEqual({ amountCents: 5 });
    await expect(readCreate(post([1, 2]))).rejects.toMatchObject({ code: "invalid_body", status: 400 });
  });

  it("reads a multipart body with its file", async () => {
    const form = new FormData();
    form.set("data", JSON.stringify({ amountCents: 5 }));
    form.set("file", new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" }));
    const request = new Request("http://portal.vitah.es/api/v1/purchases/invoices/i1/payments", { method: "POST", headers: { "Idempotency-Key": "key-from-the-header" }, body: form });

    const body = await readCreate(request, readWithFile);
    expect(body).toMatchObject({ amountCents: 5, idempotencyKey: "key-from-the-header" });
    expect(body.file).toBeInstanceOf(File);
  });
});
