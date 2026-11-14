import { reportError } from "../lib/report-error";

jest.mock("../lib/report-error", () => ({ reportError: jest.fn(async () => {}) }));

type Handler = (error: unknown, isFatal?: boolean) => void;
type Tracker = { allRejections: boolean; onUnhandled: (id: number, rejection: unknown) => void; onHandled: (id: number) => void };

const globals = globalThis as unknown as {
  ErrorUtils: { getGlobalHandler: () => Handler; setGlobalHandler: (handler: Handler) => void };
  HermesInternal?: { enablePromiseRejectionTracker: jest.Mock<void, [Tracker]> };
};
const original = globals.ErrorUtils;
const previous = jest.fn();
let handler: Handler;

/** Installs the handlers afresh (the module installs once) and returns what it set. */
function install(options?: { production?: boolean }) {
  jest.isolateModules(() => {
    const { installGlobalErrorHandlers } = jest.requireActual<typeof import("../lib/global-errors")>("../lib/global-errors");
    installGlobalErrorHandlers(options);
    installGlobalErrorHandlers(options); // A second call changes nothing.
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  globals.ErrorUtils = {
    getGlobalHandler: () => previous,
    setGlobalHandler: jest.fn((next: Handler) => {
      handler = next;
    }),
  };
  globals.HermesInternal = { enablePromiseRejectionTracker: jest.fn() };
});

afterEach(() => {
  globals.ErrorUtils = original;
  delete globals.HermesInternal;
  jest.useRealTimers();
});

describe("installGlobalErrorHandlers", () => {
  it("reports an uncaught error and hands it on to React Native's handler", () => {
    install();
    const error = new Error("in a timer");

    handler(error, false);

    expect(globals.ErrorUtils.setGlobalHandler).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error, { fatal: false });
    expect(previous).toHaveBeenCalledWith(error, false);
  });

  it("holds a fatal error until its report has left, then lets the app close", async () => {
    install();
    let reportSent!: () => void;
    jest.mocked(reportError).mockReturnValueOnce(new Promise((resolve) => (reportSent = resolve)));
    const error = new Error("fatal");

    handler(error, true);

    expect(reportError).toHaveBeenCalledWith(error, { fatal: true });
    expect(previous).not.toHaveBeenCalled();
    reportSent();
    await Promise.resolve();
    await Promise.resolve();
    expect(previous).toHaveBeenCalledWith(error, true);
  });

  it("doesn't hold a fatal error for long when the report can't get out", async () => {
    jest.useFakeTimers();
    install();
    jest.mocked(reportError).mockReturnValueOnce(new Promise(() => {}));

    handler(new Error("fatal, offline"), true);
    await jest.advanceTimersByTimeAsync(1499);
    expect(previous).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("reports unhandled promise rejections in a build", () => {
    install({ production: true });

    const [tracker] = globals.HermesInternal!.enablePromiseRejectionTracker.mock.calls[0]!;
    expect(tracker.allRejections).toBe(true);
    const rejection = new Error("nobody caught me");
    tracker.onUnhandled(1, rejection);
    tracker.onHandled(1);

    expect(reportError).toHaveBeenCalledWith(rejection);
  });

  it("leaves React Native's own rejection tracker alone in development", () => {
    install(); // Tests run as development.

    expect(globals.HermesInternal!.enablePromiseRejectionTracker).not.toHaveBeenCalled();
  });

  it("works on an engine without the rejection tracker", () => {
    delete globals.HermesInternal;

    expect(() => install({ production: true })).not.toThrow();
  });
});
