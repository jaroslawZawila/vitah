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

describe("api.listPhotos", () => {
  it("fetches the client's photos with the token", async () => {
    const photos = [
      { id: "p1", caption: "Fachada sur", sizeBytes: 1, uploadedAt: "2026-09-22T10:00:00.000Z" },
    ];
    respond(200, { photos });

    expect(await api.listPhotos("tok")).toEqual({ ok: true, data: { photos } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/photos$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("maps an expired session", async () => {
    respond(401, { error: "unauthorized" });

    expect(await api.listPhotos("tok")).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("api.photoUrl", () => {
  it("points at the photo's image", () => {
    expect(api.photoUrl("a/b")).toMatch(/\/api\/mobile\/photos\/a%2Fb$/);
  });

  it("points at the photo's thumbnail", () => {
    expect(api.photoUrl("p1", "thumb")).toMatch(/\/api\/mobile\/photos\/p1\?size=thumb$/);
  });
});

describe("account endpoints", () => {
  it("reads and saves settings with the token", async () => {
    const settings = { notifications: { progress: true, documents: false, messages: true } };
    respond(200, settings);
    respond(200, settings);

    expect(await api.getSettings("tok")).toEqual({ ok: true, data: settings });
    expect(await api.updateSettings("tok", { documents: false })).toEqual({
      ok: true,
      data: settings,
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\/api\/mobile\/settings$/);
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ notifications: { documents: false } }) });
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("passes a 4xx's error code through, e.g. a wrong current password", async () => {
    respond(400, { error: "wrong_password" });

    expect(await api.changePassword("tok", "old", "CasaNordica26")).toEqual({
      ok: false,
      error: "wrong_password",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/password$/);
    expect(JSON.parse(init.body)).toEqual({ currentPassword: "old", newPassword: "CasaNordica26" });
  });

  it("keeps a 5xx's body to itself", async () => {
    respond(500, { error: "boom" });

    expect(await api.getSettings("tok")).toEqual({ ok: false, error: "server_error" });
  });

  it("registers and removes the phone's push token", async () => {
    respond(200, { success: true });
    respond(200, { success: true });

    await api.registerPushToken("tok", "ExponentPushToken[x]", "en");
    await api.removePushToken("tok", "ExponentPushToken[x]");

    expect(fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api/, "/api"), init.method, init.body])).toEqual([
      ["/api/mobile/push-token", "POST", JSON.stringify({ token: "ExponentPushToken[x]", language: "en" })],
      ["/api/mobile/push-token", "DELETE", JSON.stringify({ token: "ExponentPushToken[x]" })],
    ]);
  });
});
