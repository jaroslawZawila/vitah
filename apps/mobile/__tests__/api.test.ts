import { api } from "../lib/api";

const fetchMock = jest.fn();
global.fetch = fetchMock;

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? "not json" : JSON.stringify(body), { status }),
  );
}

beforeEach(() => fetchMock.mockReset());

describe("api.signIn", () => {
  it("posts credentials and returns the session", async () => {
    const data = { token: "t", user: { id: "u", email: "a@b.c", name: null, role: "client", tenantId: "x" } };
    respond(200, data);

    expect(await api.signIn("a@b.c", "pw")).toEqual({ ok: true, data });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/auth$/);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ email: "a@b.c", password: "pw" }) });
  });

  it("maps rejected credentials", async () => {
    respond(401, { error: "invalid_credentials" });

    expect(await api.signIn("a@b.c", "bad")).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("maps network failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));

    expect(await api.signIn("a@b.c", "pw")).toEqual({ ok: false, error: "network_error" });
  });
});

describe("api.getProject", () => {
  const project = {
    id: "p",
    ref: "VTH-2026-014",
    address: "Calle del Sol 5",
    startDate: "2026-03-01",
    completionDate: null,
  };

  it("sends the bearer token and returns the project", async () => {
    respond(200, { project });

    expect(await api.getProject("tok")).toEqual({ ok: true, data: { project } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/project$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("returns a null project", async () => {
    respond(200, { project: null });

    expect(await api.getProject("tok")).toEqual({ ok: true, data: { project: null } });
  });

  it("maps 401 to unauthorized", async () => {
    respond(401, { error: "unauthorized" });

    expect(await api.getProject("tok")).toEqual({ ok: false, error: "unauthorized" });
  });

  it("maps a 401 without a JSON body to unauthorized", async () => {
    respond(401);

    expect(await api.getProject("tok")).toEqual({ ok: false, error: "unauthorized" });
  });

  it("maps server errors", async () => {
    respond(500, { error: "boom" });

    expect(await api.getProject("tok")).toEqual({ ok: false, error: "server_error" });
  });

  it("maps a non-JSON success body to a server error", async () => {
    respond(200);

    expect(await api.getProject("tok")).toEqual({ ok: false, error: "server_error" });
  });
});

describe("api.listDocuments", () => {
  it("fetches the client's documents with the token", async () => {
    const documents = [
      { id: "d1", title: "Contrato", category: "contract", sizeBytes: 1, uploadedAt: "2026-09-22T10:00:00.000Z" },
    ];
    respond(200, { documents });

    expect(await api.listDocuments("tok")).toEqual({ ok: true, data: { documents } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/documents$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("maps an expired session", async () => {
    respond(401, { error: "unauthorized" });

    expect(await api.listDocuments("tok")).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("api.documentUrl", () => {
  it("points at the document's file", () => {
    expect(api.documentUrl("a/b")).toMatch(/\/api\/mobile\/documents\/a%2Fb$/);
  });
});
