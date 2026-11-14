import type { ErrorReport } from "../lib/report-error";

const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

let mockExpoGo = false;
jest.mock("expo", () => ({ isRunningInExpoGo: () => mockExpoGo }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.4.0" } } }));
const mockUpdates = { isEmbeddedLaunch: true, updateId: null as string | null };
jest.mock("expo-updates", () => mockUpdates);

type Reporter = typeof import("../lib/report-error");

/** A fresh reporter: what it reported and who is signed in live in the module. */
function load(): Reporter {
  let reporter!: Reporter;
  jest.isolateModules(() => {
    reporter = jest.requireActual("../lib/report-error");
  });
  return reporter;
}

/** The reports sent so far: each call's JSON body. */
const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string) as ErrorReport);

const dev = __DEV__;
const setDev = (value: boolean) => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = value;
};
/** Forces reporting on or back to its default. One key at a time: the app reads the environment through this very object. */
const force = (on: boolean) => {
  if (on) process.env.EXPO_PUBLIC_REPORT_ERRORS = "1";
  else delete process.env.EXPO_PUBLIC_REPORT_ERRORS;
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  mockExpoGo = false;
  Object.assign(mockUpdates, { isEmbeddedLaunch: true, updateId: null });
  // Forced on: by default the reporter is silent under test.
  force(true);
});

afterEach(() => {
  force(false);
  setDev(dev);
  jest.useRealTimers();
});

describe("when it reports", () => {
  beforeEach(() => force(false));

  /** A store build: not development (tests run as development), not Expo Go. */
  const release = () => setDev(false);

  it("is silent under test and in development", async () => {
    expect(__DEV__).toBe(true);

    await load().reportError(new Error("boom"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is silent in Expo Go, even running a published bundle", async () => {
    release();
    mockExpoGo = true;

    await load().reportError(new Error("boom"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports from a build", async () => {
    release();

    await load().reportError(new Error("boom"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports in development when forced", async () => {
    force(true);

    await load().reportError(new Error("boom"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reportError", () => {
  it("posts what broke and where to the portal, and nothing else", async () => {
    const reporter = load();
    reporter.setReportScreen("/(app)/obra/pago/[id]");
    const error = new TypeError("undefined is not a function");
    error.stack = "TypeError: undefined is not a function\n    at PagoScreen (index.android.bundle:1:2)";

    await reporter.reportError(error, { fatal: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/client-error$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(sent()).toEqual([
      {
        message: "TypeError: undefined is not a function",
        stack: error.stack,
        screen: "/(app)/obra/pago/[id]",
        fatal: true,
        appVersion: "1.4.0",
        platform: "ios",
        osVersion: expect.any(String),
        locale: expect.any(String),
      },
    ]);
  });

  it("says whose phone it was with the usual Authorization header, never in the report", async () => {
    const reporter = load();
    reporter.setReportSession("session-token");

    await reporter.reportError(new Error("boom"));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ Authorization: "Bearer session-token" });
    expect(init.body).not.toContain("session-token");

    reporter.setReportSession(null);
    await reporter.reportError(new Error("signed out"));
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("keeps emails and tokens out of the message and the stack", async () => {
    const error = new Error("No session for ana@example.com (Bearer abc.def) eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.sig");
    error.stack = `${error.name}: ${error.message}\n    at signIn (ana@example.com)`;

    await load().reportError(error);

    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).not.toContain("ana@example.com");
    expect(body).not.toContain("abc.def");
    expect(body).not.toContain("eyJ");
    expect(sent()[0]!.message).toBe("Error: No session for [email] (Bearer [token] [token]");
  });

  it("only names the kind of a thrown value that isn't an error: it may hold the client's data", async () => {
    const reporter = load();

    await reporter.reportError({ ok: false, project: { address: "Calle del Sol 5" } });
    await reporter.reportError(null);
    await reporter.reportError("plain text");

    expect(sent().map((report) => report.message)).toEqual([
      "Non-error thrown: object",
      "Non-error thrown: null",
      "plain text",
    ]);
    expect(sent()[0]).not.toHaveProperty("stack");
    expect(fetchMock.mock.calls[0][1].body).not.toContain("Calle del Sol");
  });

  it("cuts a long message and keeps only the first lines of the stack", async () => {
    const error = new Error("x".repeat(2000));
    error.stack = ["Error: long", ...Array.from({ length: 30 }, (_, i) => `    at frame${i}`)].join("\n");

    await load().reportError(error);

    const [report] = sent();
    expect(report!.message).toHaveLength(300);
    expect(report!.stack!.split("\n")).toHaveLength(8);
    expect(report!.stack).toContain("frame6");
    expect(report!.stack).not.toContain("frame7");
  });

  it("names the update running when the code came over the air", async () => {
    Object.assign(mockUpdates, { isEmbeddedLaunch: false, updateId: "1a2b3c4d-0000-4000-8000-000000000000" });

    await load().reportError(new Error("boom"));

    expect(sent()[0]!.appVersion).toBe("1.4.0+1a2b3c4d");
  });

  it("reports the same error once a session", async () => {
    const reporter = load();
    const failing = () => {
      const error = new Error("render failed");
      error.stack = "Error: render failed\n    at Screen (bundle:1:1)";
      return error;
    };

    await reporter.reportError(failing());
    await reporter.reportError(failing(), { fatal: true });
    await reporter.reportError(failing());

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The same message from somewhere else is another error.
    const elsewhere = failing();
    elsewhere.stack = "Error: render failed\n    at Other (bundle:9:9)";
    await reporter.reportError(elsewhere);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a few reports a minute at most", async () => {
    jest.useFakeTimers();
    const reporter = load();

    for (let i = 0; i < 12; i++) await reporter.reportError(new Error(`error ${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(5);

    jest.advanceTimersByTime(61_000);
    await reporter.reportError(new Error("a minute later"));
    // One dropped for the limit wasn't counted as said: it goes now.
    await reporter.reportError(new Error("error 11"));
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("gives up on a portal that doesn't answer", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const settled = jest.fn();

    void load().reportError(new Error("boom")).then(settled);
    await jest.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(settled).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("never throws or rejects, whatever fails", async () => {
    const reporter = load();

    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(reporter.reportError(new Error("offline"))).resolves.toBeUndefined();

    fetchMock.mockImplementationOnce(() => {
      throw new Error("fetch is broken");
    });
    await expect(reporter.reportError(new Error("no fetch"))).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(reporter.reportError(new Error("portal down"))).resolves.toBeUndefined();

    // An "error" that can't even be read.
    const hostile = new Proxy(new Error("x"), {
      get() {
        throw new Error("no reading me");
      },
    });
    expect(() => reporter.reportError(hostile)).not.toThrow();
    await expect(reporter.reportError(hostile)).resolves.toBeUndefined();
  });
});
