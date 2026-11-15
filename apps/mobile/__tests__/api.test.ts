import { api } from "../lib/api";

const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

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

describe("api.listProjects", () => {
  const project = {
    id: "p",
    ref: "VTH-2026-014",
    address: "Calle del Sol 5",
    startDate: "2026-03-01",
    completionDate: null,
    handedOver: false,
    progressPct: 40,
  };

  it("sends the bearer token and returns the client's homes", async () => {
    respond(200, { projects: [project] });

    expect(await api.listProjects("tok")).toEqual({ ok: true, data: { projects: [project] } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/projects$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("maps 401 to unauthorized", async () => {
    respond(401, { error: "unauthorized" });

    expect(await api.listProjects("tok")).toEqual({ ok: false, error: "unauthorized" });
  });

  it("maps a 401 without a JSON body to unauthorized", async () => {
    respond(401);

    expect(await api.listProjects("tok")).toEqual({ ok: false, error: "unauthorized" });
  });

  it("maps server errors", async () => {
    respond(500, { error: "boom" });

    expect(await api.listProjects("tok")).toEqual({ ok: false, error: "server_error" });
  });

  it("maps a non-JSON success body to a server error", async () => {
    respond(200);

    expect(await api.listProjects("tok")).toEqual({ ok: false, error: "server_error" });
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
    // It names the categories it knows, so newer ones arrive as "other".
    expect(url).toMatch(/\/api\/mobile\/documents\?categories=contract,plans,certificates,other,budget$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("asks for the home shown", async () => {
    respond(200, { documents: [] });

    await api.listDocuments("tok", "p 1");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/mobile\/documents\?categories=[a-z,]+&projectId=p%201$/);
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

  it("asks for the home shown, and the obra and changes too", async () => {
    respond(200, { photos: [] });
    respond(200, { obra: null });
    respond(200, { changes: null, projects: "" });

    await api.listPhotos("tok", "p1");
    await api.getObra("tok", "p1");
    await api.getChanges("tok", "p1");
    expect(fetchMock.mock.calls.map(([url]) => url.replace(/^.*\/api\/mobile/, ""))).toEqual([
      "/photos?projectId=p1",
      "/obra?projectId=p1",
      "/changes?projectId=p1",
    ]);
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

  it("asks for the account to be deleted, and withdraws it", async () => {
    respond(200, { deletionRequestedAt: "2026-11-15T08:00:00.000Z" });
    respond(200, { deletionRequestedAt: null });

    expect(await api.requestDeletion("tok")).toEqual({
      ok: true,
      data: { deletionRequestedAt: "2026-11-15T08:00:00.000Z" },
    });
    expect(await api.withdrawDeletion("tok")).toEqual({ ok: true, data: { deletionRequestedAt: null } });
    expect(fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api/, "/api"), init.method, init.headers])).toEqual([
      ["/api/mobile/account/deletion-request", "POST", { Authorization: "Bearer tok" }],
      ["/api/mobile/account/deletion-request", "DELETE", { Authorization: "Bearer tok" }],
    ]);
  });
});

describe("api.getChanges", () => {
  it("sends the bearer token and returns the counters", async () => {
    const changes = { projectId: "p", project: 1, obra: 4, photos: 2, documents: 0 };
    respond(200, { changes });

    expect(await api.getChanges("tok")).toEqual({ ok: true, data: { changes } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/changes$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("maps a server without the endpoint to an error", async () => {
    respond(404, { error: "not_found" });

    expect((await api.getChanges("tok")).ok).toBe(false);
  });
});

describe("timeouts", () => {
  /** A fetch that never answers, until the call's signal aborts it (as the real one does). */
  function hang(_url: string, init: RequestInit) {
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("gives every call a signal to abort it with", async () => {
    respond(200, { projects: [] });

    await api.listProjects("tok");

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(jest.getTimerCount()).toBe(0); // The timer goes with the answer.
  });

  it("gives up on a server that doesn't answer, as a timeout", async () => {
    fetchMock.mockImplementationOnce(hang);

    const call = api.getObra("tok");
    await jest.advanceTimersByTimeAsync(14_999);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(await call).toEqual({ ok: false, error: "timeout" });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("times sign-in out too", async () => {
    fetchMock.mockImplementationOnce(hang);

    const call = api.signIn("a@b.c", "pw");
    await jest.advanceTimersByTimeAsync(15_000);

    expect(await call).toEqual({ ok: false, error: "timeout" });
  });

  it.each([200, 401, 500])("gives up on a %i answer that never finishes arriving", async (status) => {
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => ({
      status,
      ok: status < 400,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    }));

    const call = api.listPhotos("tok");
    await jest.advanceTimersByTimeAsync(15_000);

    // Not "unauthorized": a cut-off 401 must not sign the client out.
    expect(await call).toEqual({ ok: false, error: "timeout" });
  });

  it("tells a lost connection from a timeout", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));

    expect(await api.getObra("tok")).toEqual({ ok: false, error: "network_error" });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("error mapping", () => {
  it.each([
    [401, { error: "invalid_credentials" }, "invalid_credentials"],
    [401, { error: "unauthorized" }, "unauthorized"],
    [401, undefined, "unauthorized"],
    [429, { error: "too_many_attempts" }, "too_many_attempts"],
    [400, { error: "wrong_password" }, "wrong_password"],
    [404, undefined, "server_error"],
    [500, { error: "internal_error" }, "server_error"],
    [502, undefined, "server_error"],
    [503, { error: "too_many_attempts" }, "server_error"],
  ])("%i %j → %s", async (status, body, error) => {
    respond(status, body);

    expect(await api.signIn("a@b.c", "pw")).toEqual({ ok: false, error });
  });
});

describe("warranty endpoints", () => {
  it("sends a claim for the home shown, with its key", async () => {
    respond(200, { claimId: "c", number: 1 });
    const claim = { kind: "damp" as const, room: "kitchen" as const, description: "Humedad", urgent: false };

    expect(await api.createWarrantyClaim("tok", "p2", claim, "key-0123456789abcdef")).toEqual({ ok: true, data: { claimId: "c", number: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/warranty\?projectId=p2$/);
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json", "Idempotency-Key": "key-0123456789abcdef" },
      body: JSON.stringify(claim),
    });
  });

  it("uploads one photo per request, as a file part, with its own key", async () => {
    respond(200, { photoId: "ph" });

    await api.addWarrantyPhoto("tok", "c 1", { uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg" }, "key-photo-0123456789");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/warranty\/c%201\/photos$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok", "Idempotency-Key": "key-photo-0123456789" });
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("passes the server's reasons through, e.g. too many claims today", async () => {
    respond(429, { error: "too_many_claims_today" });
    expect(await api.createWarrantyClaim("tok", null, { kind: "other", room: "other", description: "x" }, "k".repeat(16))).toEqual({
      ok: false,
      error: "too_many_claims_today",
    });
  });

  it("reads and cancels a claim, and points at its photos", async () => {
    respond(200, { id: "c" });
    respond(200, { claimId: "c" });

    await api.getWarrantyClaim("tok", "c");
    await api.cancelWarrantyClaim("tok", "c");
    expect(fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api/, "/api"), init.method])).toEqual([
      ["/api/mobile/warranty/c", "GET"],
      ["/api/mobile/warranty/c/cancel", "POST"],
    ]);
    expect(api.warrantyPhotoUrl("c", "ph", "thumb")).toMatch(/\/api\/mobile\/warranty\/c\/photos\/ph\?size=thumb$/);
  });
});
